#!/usr/bin/env python3
"""
Alpha Oracle Agent
==================
Reads trading signals and posts them on-chain to Solana.
Verifies results after timeframe expires.
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
import subprocess
import base58
from typing import Optional, Dict, Any, List

# Paths
SIGNALS_PATH = Path("/Users/clanker/clawd/trading/current_signals.json")
WALLET_PATH = Path.home() / ".config/solana/jimmy-solana.json"
PREDICTIONS_LOG = Path(__file__).parent / "predictions.json"

# Solana config
PROGRAM_ID = "BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV"
RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")

# Price precision (6 decimals like USDC)
PRICE_DECIMALS = 6
PRICE_MULTIPLIER = 10 ** PRICE_DECIMALS


def load_signals() -> Dict[str, Any]:
    """Load current trading signals"""
    if not SIGNALS_PATH.exists():
        return {"all_signals": [], "actionable": []}
    with open(SIGNALS_PATH) as f:
        return json.load(f)


def load_predictions_log() -> List[Dict]:
    """Load the local predictions log"""
    if not PREDICTIONS_LOG.exists():
        return []
    with open(PREDICTIONS_LOG) as f:
        return json.load(f)


def save_predictions_log(predictions: List[Dict]):
    """Save the local predictions log"""
    with open(PREDICTIONS_LOG, "w") as f:
        json.dump(predictions, f, indent=2)


def price_to_u64(price: float) -> int:
    """Convert price to u64 with 6 decimals"""
    return int(price * PRICE_MULTIPLIER)


def format_prediction_for_display(signal: Dict) -> str:
    """Format a signal for display"""
    direction = "🟢 LONG" if signal.get("signal") == 1 else "🔴 SHORT"
    return f"""
📊 **{signal['symbol']}** {direction}
├─ Entry: ${signal['price']:,.2f}
├─ TP: ${signal.get('take_profit_price', 0):,.2f} ({signal.get('take_profit_pct', 0)*100:.1f}%)
├─ SL: ${signal.get('stop_loss_price', 0):,.2f} ({signal.get('stop_loss_pct', 0)*100:.1f}%)
├─ R:R: {signal.get('rr_ratio', 0):.2f}
└─ Strategy: {signal.get('strategy', 'unknown')}
"""


def create_prediction_tx(signal: Dict, timeframe_hours: int = 24) -> Optional[str]:
    """
    Create a prediction transaction on-chain.
    Returns the transaction signature or None on failure.
    
    This is a placeholder - actual implementation would use:
    - @coral-xyz/anchor for TypeScript
    - anchorpy for Python
    - Direct RPC calls
    """
    # For devnet testing, we'll log the prediction locally
    # and return a mock tx signature
    
    prediction = {
        "asset": signal["symbol"],
        "direction": "LONG" if signal.get("signal") == 1 else "SHORT",
        "entry_price": price_to_u64(signal["price"]),
        "take_profit": price_to_u64(signal.get("take_profit_price", signal["price"] * 1.05)),
        "stop_loss": price_to_u64(signal.get("stop_loss_price", signal["price"] * 0.95)),
        "timeframe_hours": timeframe_hours,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": datetime.utcnow().timestamp() + (timeframe_hours * 3600),
        "status": "active",
        "original_signal": signal
    }
    
    # Load and update predictions log
    predictions = load_predictions_log()
    prediction["local_id"] = len(predictions)
    predictions.append(prediction)
    save_predictions_log(predictions)
    
    # Mock tx signature for now
    tx_sig = f"mock_{prediction['local_id']}_{int(time.time())}"
    print(f"📝 Created prediction: {signal['symbol']} {prediction['direction']}")
    print(f"   TX: {tx_sig}")
    
    return tx_sig


def verify_predictions():
    """
    Check expired predictions and verify results.
    In production, this would:
    1. Fetch current prices from Pyth or other oracle
    2. Call verify_prediction instruction on-chain
    """
    predictions = load_predictions_log()
    current_time = time.time()
    
    for pred in predictions:
        if pred["status"] != "active":
            continue
        
        if current_time >= pred["expires_at"]:
            # TODO: Fetch actual price from Pyth
            # For now, mark as needs_verification
            pred["status"] = "needs_verification"
            print(f"⏰ Prediction {pred['asset']} expired, needs verification")
    
    save_predictions_log(predictions)


def get_oracle_stats() -> Dict[str, Any]:
    """Get oracle statistics"""
    predictions = load_predictions_log()
    
    total = len(predictions)
    active = sum(1 for p in predictions if p["status"] == "active")
    won = sum(1 for p in predictions if p["status"] == "won")
    lost = sum(1 for p in predictions if p["status"] == "lost")
    
    win_rate = won / (won + lost) * 100 if (won + lost) > 0 else 0
    
    return {
        "total_predictions": total,
        "active": active,
        "won": won,
        "lost": lost,
        "win_rate": win_rate,
    }


def process_new_signals():
    """Process new actionable signals from the trading system"""
    signals = load_signals()
    actionable = signals.get("actionable", [])
    
    if not actionable:
        print("📭 No actionable signals at the moment")
        # Check if there are any valid setups in all_signals
        all_signals = signals.get("all_signals", [])
        valid = [s for s in all_signals if s.get("valid_setup")]
        if valid:
            print(f"   Found {len(valid)} valid setups (not actionable yet)")
        return []
    
    print(f"🎯 Found {len(actionable)} actionable signals!")
    
    tx_sigs = []
    for signal in actionable:
        print(format_prediction_for_display(signal))
        tx_sig = create_prediction_tx(signal)
        if tx_sig:
            tx_sigs.append(tx_sig)
    
    return tx_sigs


def main():
    """Main oracle loop"""
    print("🔮 Alpha Oracle Agent Starting...")
    print(f"   Program ID: {PROGRAM_ID}")
    print(f"   RPC: {RPC_URL}")
    print(f"   Signals: {SIGNALS_PATH}")
    print()
    
    # Process new signals
    tx_sigs = process_new_signals()
    
    # Verify expired predictions
    verify_predictions()
    
    # Show stats
    stats = get_oracle_stats()
    print(f"""
📈 Oracle Stats:
├─ Total predictions: {stats['total_predictions']}
├─ Active: {stats['active']}
├─ Won: {stats['won']}
├─ Lost: {stats['lost']}
└─ Win rate: {stats['win_rate']:.1f}%
""")
    
    return tx_sigs


if __name__ == "__main__":
    main()
