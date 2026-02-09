import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const idl = JSON.parse(fs.readFileSync(join(__dirname2, "../target/idl/alpha_oracle.json"), "utf-8"));

const PROGRAM_ID = new PublicKey("BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV");

interface Signal {
  symbol: string;
  timeframe: string;
  direction: string;
  entry: number;
  tp: number;
  sl: number;
  rr: number;
  rsi: number;
  liq_pressure: number;
  taker_flow: number;
  flow_conf: string;
}

function priceToMicro(price: number): BN {
  return new BN(Math.round(price * 1_000_000));
}

function tfToHours(tf: string): number {
  const map: Record<string, number> = {
    "15m": 1,    // Expire in 1h for 15m signals
    "1h": 4,     // Expire in 4h for 1h signals
    "4h": 16,
    "1d": 48,
  };
  return map[tf] || 4;
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const walletPath = process.env.HOME + "/.config/solana/jimmy-solana.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = new Program(idl as any, provider);

  // Derive oracle PDA
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );

  // Load oracle to get current prediction count
  const oracle = await program.account.oracle.fetch(oraclePda);
  const predictionId = oracle.totalPredictions;

  // Load signals from live_signals.json
  const signalsPath = process.env.HOME + "/clawd/trading/live_signals.json";
  const signalsData = JSON.parse(fs.readFileSync(signalsPath, "utf-8"));
  
  if (!signalsData.signals || signalsData.signals.length === 0) {
    console.log("❌ No signals to post");
    return;
  }

  // Post each signal as a prediction
  let posted = 0;
  for (const sig of signalsData.signals as Signal[]) {
    // Only post signals with all factors aligned (flow_conf === "✅")
    if (sig.flow_conf !== "✅") {
      console.log(`⏭️  Skipping ${sig.symbol} ${sig.timeframe} — flow not confirmed`);
      continue;
    }

    const currentPredId = new BN(predictionId.toNumber() + posted);
    
    // Derive prediction PDA
    const [predictionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("prediction"), oraclePda.toBuffer(), currentPredId.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );

    const direction = sig.direction === "LONG" ? { long: {} } : { short: {} };
    const timeframeHours = tfToHours(sig.timeframe);

    console.log(`\n📊 Posting: ${sig.direction} ${sig.symbol} ${sig.timeframe}`);
    console.log(`   Entry: $${sig.entry} | SL: $${sig.sl} | TP: $${sig.tp} | R:R: ${sig.rr.toFixed(1)}`);
    console.log(`   Flow: ${sig.taker_flow > 0 ? '+' : ''}${sig.taker_flow.toFixed(1)}% | RSI: ${sig.rsi.toFixed(1)} | Liq: ${sig.liq_pressure.toFixed(1)}`);

    try {
      const tx = await program.methods
        .createPrediction(
          sig.symbol,
          direction,
          priceToMicro(sig.entry),
          priceToMicro(sig.tp),
          priceToMicro(sig.sl),
          timeframeHours
        )
        .accounts({
          oracle: oraclePda,
          prediction: predictionPda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();

      console.log(`   ✅ TX: ${tx}`);
      console.log(`   📍 Prediction PDA: ${predictionPda.toBase58()}`);
      posted++;
    } catch (e: any) {
      console.error(`   ❌ Error: ${e.message}`);
    }
  }

  console.log(`\n🎯 Posted ${posted}/${signalsData.signals.length} predictions on-chain`);
  
  // Show updated oracle stats
  const updatedOracle = await program.account.oracle.fetch(oraclePda);
  console.log(`📈 Oracle stats: ${updatedOracle.totalPredictions} total predictions`);
}

main().catch(console.error);
