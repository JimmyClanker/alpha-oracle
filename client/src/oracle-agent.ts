/**
 * Alpha Oracle Agent
 * Reads trading signals from the adaptive trading system
 * and posts them as on-chain predictions on Solana.
 */
import * as fs from "fs";
import { BN } from "@coral-xyz/anchor";
import { getProgram, getProvider, getOraclePDA, loadKeypair, priceToU64, u64ToPrice, SIGNALS_PATH } from "./config.js";

interface TradingSignal {
  symbol: string;
  signal: number; // 1 = LONG, -1 = SHORT
  signal_name: string;
  price: number;
  take_profit_price: number;
  stop_loss_price: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  rr_ratio: number;
  strategy: string;
  valid_setup: boolean;
  invalid_reason?: string;
  timestamp: string;
}

interface SignalsFile {
  timestamp: string;
  all_signals: TradingSignal[];
  actionable?: TradingSignal[];
}

function loadSignals(): SignalsFile {
  if (!fs.existsSync(SIGNALS_PATH)) {
    return { timestamp: new Date().toISOString(), all_signals: [], actionable: [] };
  }
  return JSON.parse(fs.readFileSync(SIGNALS_PATH, "utf-8"));
}

async function createPrediction(
  program: any,
  keypair: any,
  signal: TradingSignal,
  timeframeHours: number = 24
): Promise<string | null> {
  const [oraclePDA] = getOraclePDA(keypair.publicKey);

  const direction = signal.signal === 1 ? { long: {} } : { short: {} };
  const entryPrice = new BN(priceToU64(signal.price).toString());
  const takeProfit = new BN(priceToU64(signal.take_profit_price).toString());
  const stopLoss = new BN(priceToU64(signal.stop_loss_price).toString());

  console.log(`\n📊 Creating prediction: ${signal.symbol} ${signal.signal_name}`);
  console.log(`   Entry: $${signal.price.toFixed(2)}`);
  console.log(`   TP: $${signal.take_profit_price.toFixed(2)} (${(signal.take_profit_pct * 100).toFixed(1)}%)`);
  console.log(`   SL: $${signal.stop_loss_price.toFixed(2)} (${(signal.stop_loss_pct * 100).toFixed(1)}%)`);
  console.log(`   R:R: ${signal.rr_ratio.toFixed(2)}`);
  console.log(`   Strategy: ${signal.strategy}`);

  try {
    const tx = await program.methods
      .createPrediction(
        signal.symbol,
        direction,
        entryPrice,
        takeProfit,
        stopLoss,
        timeframeHours
      )
      .accounts({
        authority: keypair.publicKey,
      })
      .signers([keypair])
      .rpc();

    console.log(`   ✅ TX: ${tx}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    return tx;
  } catch (err: any) {
    console.error(`   ❌ Failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const keypair = loadKeypair();
  const provider = getProvider(keypair);
  const program = getProgram(provider);
  const [oraclePDA] = getOraclePDA(keypair.publicKey);

  console.log("🔮 Alpha Oracle Agent Starting...");
  console.log(`   Program: ${program.programId.toBase58()}`);
  console.log(`   Authority: ${keypair.publicKey.toBase58()}`);
  console.log(`   Oracle PDA: ${oraclePDA.toBase58()}`);

  // Check oracle exists
  try {
    const oracle = await program.account.oracle.fetch(oraclePDA);
    console.log(`   Oracle: "${oracle.name}"`);
    console.log(`   Total predictions: ${oracle.totalPredictions}`);
    console.log(`   Record: ${oracle.wins}W - ${oracle.losses}L`);
  } catch (e) {
    console.error("❌ Oracle not initialized! Run: npm run init");
    return;
  }

  // Load signals
  const signals = loadSignals();
  console.log(`\n📡 Signal timestamp: ${signals.timestamp}`);
  
  // Process all signals (even invalid ones for demo/tracking)
  const allSignals = signals.all_signals || [];
  console.log(`   Total signals: ${allSignals.length}`);

  // Filter to valid signals with reasonable R:R
  const validSignals = allSignals.filter(s => {
    // For demo purposes, accept signals with R:R > 0.5
    // In production, you'd want R:R > 2+
    return s.price > 0 && s.take_profit_price > 0 && s.stop_loss_price > 0;
  });

  if (validSignals.length === 0) {
    console.log("📭 No signals to process");
    return;
  }

  console.log(`   Processing ${validSignals.length} signals...`);

  const txSigs: string[] = [];
  for (const signal of validSignals) {
    const tx = await createPrediction(program, keypair, signal);
    if (tx) txSigs.push(tx);
    // Small delay between txs
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Created ${txSigs.length} predictions on-chain`);
}

main().catch(console.error);
