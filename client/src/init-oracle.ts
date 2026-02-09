/**
 * Initialize the Alpha Oracle on-chain.
 * Run once to create the oracle PDA for our wallet.
 */
import { getProgram, getProvider, getOraclePDA, loadKeypair } from "./config.js";
import { BN } from "@coral-xyz/anchor";

async function main() {
  const keypair = loadKeypair();
  const provider = getProvider(keypair);
  const program = getProgram(provider);

  const [oraclePDA] = getOraclePDA(keypair.publicKey);
  
  console.log("🔮 Initializing Alpha Oracle...");
  console.log(`   Authority: ${keypair.publicKey.toBase58()}`);
  console.log(`   Oracle PDA: ${oraclePDA.toBase58()}`);
  console.log(`   Program: ${program.programId.toBase58()}`);

  try {
    // Check if oracle already exists
    const existing = await program.account.oracle.fetchNullable(oraclePDA);
    if (existing) {
      console.log("✅ Oracle already initialized!");
      console.log(`   Name: ${existing.name}`);
      console.log(`   Total predictions: ${existing.totalPredictions}`);
      console.log(`   Wins: ${existing.wins} | Losses: ${existing.losses}`);
      return;
    }
  } catch (e) {
    // Account doesn't exist, proceed with init
  }

  const tx = await program.methods
    .initializeOracle("Alpha Oracle by Jimmy Clanker")
    .accounts({
      authority: keypair.publicKey,
    })
    .signers([keypair])
    .rpc();

  console.log(`✅ Oracle initialized! TX: ${tx}`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
}

main().catch(console.error);
