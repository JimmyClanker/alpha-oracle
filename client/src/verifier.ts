/**
 * Alpha Oracle Verifier
 * Checks expired predictions and verifies them against real prices.
 * Uses CoinGecko API for price feeds (Pyth integration TODO).
 */
import { BN } from "@coral-xyz/anchor";
import { getProgram, getProvider, getOraclePDA, getPredictionPDA, loadKeypair, priceToU64, u64ToPrice } from "./config.js";

// CoinGecko API for price data (free, no key needed)
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOGE: "dogecoin",
  ADA: "cardano",
};

async function getCurrentPrice(symbol: string): Promise<number | null> {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) {
    console.warn(`   ⚠️ No CoinGecko ID for ${symbol}`);
    return null;
  }
  
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    const data = await res.json();
    return data[id]?.usd || null;
  } catch (err) {
    console.error(`   ❌ Price fetch failed for ${symbol}`);
    return null;
  }
}

async function main() {
  const keypair = loadKeypair();
  const provider = getProvider(keypair);
  const program = getProgram(provider);
  const [oraclePDA] = getOraclePDA(keypair.publicKey);

  console.log("🔍 Alpha Oracle Verifier Starting...");

  // Fetch oracle state
  const oracle = await program.account.oracle.fetch(oraclePDA);
  const totalPredictions = Number(oracle.totalPredictions);
  console.log(`   Total predictions to check: ${totalPredictions}`);

  const now = Math.floor(Date.now() / 1000);
  let verified = 0;
  let skipped = 0;

  for (let i = 0; i < totalPredictions; i++) {
    const [predPDA] = getPredictionPDA(oraclePDA, i);
    
    try {
      const prediction = await program.account.prediction.fetch(predPDA);
      
      // Skip already verified
      const status = Object.keys(prediction.status)[0];
      if (status !== "active") {
        skipped++;
        continue;
      }

      // Check if expired
      const expiresAt = Number(prediction.expiresAt);
      if (now < expiresAt) {
        const remaining = expiresAt - now;
        const hours = Math.floor(remaining / 3600);
        const mins = Math.floor((remaining % 3600) / 60);
        console.log(`   ⏳ Prediction #${i} (${prediction.asset}): ${hours}h ${mins}m remaining`);
        continue;
      }

      // Get current price
      const currentPrice = await getCurrentPrice(prediction.asset);
      if (!currentPrice) {
        console.log(`   ⚠️ Cannot verify #${i} (${prediction.asset}): no price data`);
        continue;
      }

      const resultPrice = new BN(priceToU64(currentPrice).toString());
      const direction = Object.keys(prediction.direction)[0];
      const entryPrice = u64ToPrice(prediction.entryPrice);
      const tp = u64ToPrice(prediction.takeProfit);
      const sl = u64ToPrice(prediction.stopLoss);

      console.log(`\n📋 Verifying Prediction #${i}:`);
      console.log(`   Asset: ${prediction.asset} ${direction.toUpperCase()}`);
      console.log(`   Entry: $${entryPrice.toFixed(2)} → Current: $${currentPrice.toFixed(2)}`);
      console.log(`   TP: $${tp.toFixed(2)} | SL: $${sl.toFixed(2)}`);

      // Submit verification on-chain
      try {
        const tx = await program.methods
          .verifyPrediction(resultPrice)
          .accounts({
            oracle: oraclePDA,
            prediction: predPDA,
            verifier: keypair.publicKey,
          })
          .signers([keypair])
          .rpc();

        // Fetch updated prediction to see result
        const updated = await program.account.prediction.fetch(predPDA);
        const result = Object.keys(updated.status)[0];
        const emoji = result === "won" ? "🟢" : "🔴";
        console.log(`   ${emoji} Result: ${result.toUpperCase()} | TX: ${tx}`);
        verified++;
      } catch (err: any) {
        console.error(`   ❌ Verify TX failed: ${err.message}`);
      }

      // Rate limit CoinGecko
      await new Promise(r => setTimeout(r, 1500));

    } catch (err: any) {
      console.error(`   ❌ Error fetching prediction #${i}: ${err.message}`);
    }
  }

  // Show updated stats
  const updatedOracle = await program.account.oracle.fetch(oraclePDA);
  console.log(`\n📈 Verification complete!`);
  console.log(`   Verified: ${verified} | Skipped: ${skipped}`);
  console.log(`   Oracle Record: ${updatedOracle.wins}W - ${updatedOracle.losses}L`);
  const total = Number(updatedOracle.wins) + Number(updatedOracle.losses);
  if (total > 0) {
    const winRate = (Number(updatedOracle.wins) / total * 100).toFixed(1);
    console.log(`   Win Rate: ${winRate}%`);
  }
}

main().catch(console.error);
