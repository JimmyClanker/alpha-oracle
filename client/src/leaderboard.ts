/**
 * Alpha Oracle Leaderboard
 * Query all predictions and show oracle stats.
 */
import { getProgram, getProvider, getOraclePDA, getPredictionPDA, loadKeypair, u64ToPrice } from "./config.js";

async function main() {
  const keypair = loadKeypair();
  const provider = getProvider(keypair);
  const program = getProgram(provider);
  const [oraclePDA] = getOraclePDA(keypair.publicKey);

  console.log("🏆 Alpha Oracle Leaderboard\n");

  const oracle = await program.account.oracle.fetch(oraclePDA);
  const totalPredictions = Number(oracle.totalPredictions);
  const wins = Number(oracle.wins);
  const losses = Number(oracle.losses);
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : "N/A";

  console.log(`Oracle: "${oracle.name}"`);
  console.log(`Authority: ${oracle.authority.toBase58()}`);
  console.log(`Created: ${new Date(Number(oracle.createdAt) * 1000).toISOString()}`);
  console.log(`\n📊 Stats:`);
  console.log(`   Total Predictions: ${totalPredictions}`);
  console.log(`   Verified: ${total}`);
  console.log(`   Wins: ${wins} 🟢`);
  console.log(`   Losses: ${losses} 🔴`);
  console.log(`   Win Rate: ${winRate}%`);
  console.log(`   Active: ${totalPredictions - total}`);

  // List all predictions
  console.log(`\n📋 Predictions:`);
  console.log("─".repeat(80));

  let totalPnL = 0;
  let streak = 0;
  let bestStreak = 0;

  for (let i = 0; i < totalPredictions; i++) {
    const [predPDA] = getPredictionPDA(oraclePDA, i);
    try {
      const pred = await program.account.prediction.fetch(predPDA);
      const status = Object.keys(pred.status)[0];
      const direction = Object.keys(pred.direction)[0];
      const entry = u64ToPrice(pred.entryPrice);
      const tp = u64ToPrice(pred.takeProfit);
      const sl = u64ToPrice(pred.stopLoss);
      const result = u64ToPrice(pred.resultPrice);
      
      const statusEmoji = status === "won" ? "🟢" : status === "lost" ? "🔴" : "⏳";
      const dirEmoji = direction === "long" ? "📈" : "📉";

      // Calculate PnL
      let pnl = 0;
      if (status === "won" || status === "lost") {
        pnl = direction === "long" 
          ? ((result - entry) / entry) * 100
          : ((entry - result) / entry) * 100;
        totalPnL += pnl;
      }

      // Track streak
      if (status === "won") {
        streak = Math.max(0, streak) + 1;
        bestStreak = Math.max(bestStreak, streak);
      } else if (status === "lost") {
        streak = Math.min(0, streak) - 1;
      }

      console.log(
        `#${i} ${statusEmoji} ${pred.asset.padEnd(5)} ${dirEmoji} ${direction.toUpperCase().padEnd(5)} ` +
        `Entry: $${entry.toFixed(2).padStart(10)} → ${status === "active" ? "pending" : `$${result.toFixed(2).padStart(10)}`} ` +
        `${pnl !== 0 ? `(${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%)` : ""}`
      );
    } catch {
      console.log(`#${i} ❓ Could not fetch`);
    }
  }

  console.log("─".repeat(80));
  console.log(`\n💰 Total PnL: ${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}%`);
  console.log(`🔥 Best Win Streak: ${bestStreak}`);
}

main().catch(console.error);
