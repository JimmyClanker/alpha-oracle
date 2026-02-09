/**
 * Alpha Oracle Demo
 * End-to-end demo: init oracle, create predictions, show leaderboard.
 * For use in presentations and hackathon demos.
 */
import { BN } from "@coral-xyz/anchor";
import { getProgram, getProvider, getOraclePDA, loadKeypair, priceToU64 } from "./config.js";

async function main() {
  const keypair = loadKeypair();
  const provider = getProvider(keypair);
  const program = getProgram(provider);
  const [oraclePDA] = getOraclePDA(keypair.publicKey);

  console.log("═".repeat(60));
  console.log("  🔮 ALPHA ORACLE - Verifiable On-Chain Trading Signals");
  console.log("═".repeat(60));
  console.log(`  Program: ${program.programId.toBase58()}`);
  console.log(`  Authority: ${keypair.publicKey.toBase58()}`);
  console.log(`  Network: Devnet`);
  console.log("═".repeat(60));

  // Step 1: Initialize Oracle (if needed)
  console.log("\n📝 Step 1: Initialize Oracle");
  try {
    const existing = await program.account.oracle.fetchNullable(oraclePDA);
    if (existing) {
      console.log(`   ✅ Oracle already exists: "${existing.name}"`);
    } else {
      const tx = await program.methods
        .initializeOracle("Alpha Oracle Demo")
        .accounts({ authority: keypair.publicKey })
        .signers([keypair])
        .rpc();
      console.log(`   ✅ Initialized! TX: ${tx}`);
    }
  } catch (err: any) {
    console.error(`   ❌ Init failed: ${err.message}`);
    return;
  }

  // Step 2: Create sample predictions
  console.log("\n📊 Step 2: Create Demo Predictions");
  
  const demoPredictions = [
    { asset: "BTC", direction: { long: {} }, entry: 97000, tp: 100000, sl: 94000 },
    { asset: "ETH", direction: { long: {} }, entry: 2700, tp: 3000, sl: 2500 },
    { asset: "SOL", direction: { short: {} }, entry: 200, tp: 180, sl: 220 },
  ];

  for (const pred of demoPredictions) {
    try {
      const tx = await program.methods
        .createPrediction(
          pred.asset,
          pred.direction,
          new BN(priceToU64(pred.entry).toString()),
          new BN(priceToU64(pred.tp).toString()),
          new BN(priceToU64(pred.sl).toString()),
          1 // 1 hour timeframe for demo
        )
        .accounts({ authority: keypair.publicKey })
        .signers([keypair])
        .rpc();
      
      const dir = "long" in pred.direction ? "LONG" : "SHORT";
      console.log(`   ✅ ${pred.asset} ${dir} @ $${pred.entry} → TX: ${tx.slice(0, 20)}...`);
    } catch (err: any) {
      console.error(`   ❌ ${pred.asset}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Step 3: Show oracle stats
  console.log("\n📈 Step 3: Oracle Stats");
  const oracle = await program.account.oracle.fetch(oraclePDA);
  console.log(`   Total Predictions: ${oracle.totalPredictions}`);
  console.log(`   Record: ${oracle.wins}W - ${oracle.losses}L`);

  console.log("\n═".repeat(60));
  console.log("  Demo complete! Predictions are now on-chain.");
  console.log("  Run 'npm run verify' after expiry to verify results.");
  console.log("  Run 'npm run leaderboard' to see the full dashboard.");
  console.log("═".repeat(60));
}

main().catch(console.error);
