import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const idl = JSON.parse(fs.readFileSync(join(__dirname2, "../target/idl/alpha_oracle.json"), "utf-8"));

const PROGRAM_ID = new PublicKey("BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load wallet
  const walletPath = process.env.HOME + "/.config/solana/jimmy-solana.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", await connection.getBalance(wallet.publicKey) / 1e9, "SOL");

  // Setup provider
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
  console.log("Oracle PDA:", oraclePda.toBase58());

  // Check if already initialized
  try {
    const existing = await program.account.oracle.fetch(oraclePda);
    console.log("Oracle already initialized!");
    console.log("  Name:", existing.name);
    console.log("  Total predictions:", existing.totalPredictions.toString());
    console.log("  Wins:", existing.wins.toString());
    console.log("  Losses:", existing.losses.toString());
    return;
  } catch (e) {
    // Not initialized yet, proceed
  }

  // Initialize oracle
  console.log("\nInitializing oracle...");
  const tx = await program.methods
    .initializeOracle("Jimmy Alpha Oracle")
    .accounts({
      oracle: oraclePda,
      authority: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();

  console.log("✅ Oracle initialized!");
  console.log("  TX:", tx);
  console.log("  Oracle PDA:", oraclePda.toBase58());
  
  // Verify
  const oracle = await program.account.oracle.fetch(oraclePda);
  console.log("  Name:", oracle.name);
  console.log("  Authority:", oracle.authority.toBase58());
}

main().catch(console.error);
