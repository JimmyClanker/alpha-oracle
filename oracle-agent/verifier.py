#!/usr/bin/env python3
"""
Alpha Oracle Verifier
=====================
Verifies expired predictions against real prices from Pyth.
"""

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import httpx

# Pyth Price Feed IDs (mainnet)
PYTH_FEED_IDS = {
    "BTC": "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "ETH": "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "SOL": "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "XRP": "ec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8",
    "DOGE": "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
    "AVAX": "93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7",
    "BNB": "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
    "ADA": "2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d",
    "LINK": "8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
    "DOT": "ca3eed9315f797c08b46e47573ba63b2bcfe8b5d8ba7e32c389de8a9c8da7c43",
    "MATIC": "5de33440f98a2f02b4dc6d2a8b26ccfa4c0e91e3cd5f63e7b2b2b7fddf4c8c4c",
    "NEAR": "c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750",
    "APT": "03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5",
    "SUI": "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    "SEI": "53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb",
    "INJ": "7a5bc1d2b56ad029048cd63964b3ad2776eadf812eef1a0bef6c4e77c71cc91b",
    "ATOM": "b00b60f88b03a6a625a8d1c048c3f66653edf217439cb2c234e3be4b78b07ac9",
    "HYPE": "8d8d2b4b4c4f0c7c4c4f0c7c4c4f0c7c4c4f0c7c4c4f0c7c4c4f0c7c4c4f0c7c",  # Placeholder
    "ARB": "3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5",
    "OP": "385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf",
}

# Pyth API endpoints
PYTH_HERMES_URL = "https://hermes.pyth.network"

PREDICTIONS_LOG = Path(__file__).parent / "predictions.json"


def load_predictions() -> List[Dict]:
    """Load predictions from local log"""
    if not PREDICTIONS_LOG.exists():
        return []
    with open(PREDICTIONS_LOG) as f:
        return json.load(f)


def save_predictions(predictions: List[Dict]):
    """Save predictions to local log"""
    with open(PREDICTIONS_LOG, "w") as f:
        json.dump(predictions, f, indent=2)


def get_pyth_price(asset: str) -> Optional[float]:
    """
    Get current price from Pyth Network.
    Returns price or None if not available.
    """
    feed_id = PYTH_FEED_IDS.get(asset)
    if not feed_id:
        print(f"⚠️ No Pyth feed for {asset}")
        return None
    
    try:
        url = f"{PYTH_HERMES_URL}/v2/updates/price/latest"
        params = {"ids[]": feed_id}
        
        with httpx.Client(timeout=10) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        
        if "parsed" in data and len(data["parsed"]) > 0:
            price_data = data["parsed"][0]["price"]
            price = int(price_data["price"]) * (10 ** int(price_data["expo"]))
            return price
        
        return None
    except Exception as e:
        print(f"❌ Error fetching price for {asset}: {e}")
        return None


def verify_prediction(prediction: Dict, current_price: float) -> str:
    """
    Verify a prediction against current price.
    Returns 'won', 'lost', or 'inconclusive'.
    """
    direction = prediction.get("direction", "LONG")
    entry = prediction.get("entry_price", 0) / 1_000_000  # Convert from micro-units
    tp = prediction.get("take_profit", 0) / 1_000_000
    sl = prediction.get("stop_loss", 0) / 1_000_000
    
    if direction == "LONG":
        # Win: price >= TP, or price > entry without hitting SL
        if current_price >= tp:
            return "won"
        elif current_price <= sl:
            return "lost"
        elif current_price > entry:
            return "won"  # Partial win - above entry
        else:
            return "lost"  # Below entry without hitting TP
    else:  # SHORT
        # Win: price <= TP, or price < entry without hitting SL
        if current_price <= tp:
            return "won"
        elif current_price >= sl:
            return "lost"
        elif current_price < entry:
            return "won"  # Partial win - below entry
        else:
            return "lost"  # Above entry without hitting TP


def process_expired_predictions():
    """
    Find and verify all expired predictions.
    """
    predictions = load_predictions()
    current_time = time.time()
    verified_count = 0
    
    for pred in predictions:
        if pred.get("status") != "active":
            continue
        
        expires_at = pred.get("expires_at", 0)
        if current_time < expires_at:
            continue  # Not expired yet
        
        asset = pred.get("asset", "")
        current_price = get_pyth_price(asset)
        
        if current_price is None:
            pred["status"] = "needs_manual_verification"
            print(f"⏭️ {asset} prediction needs manual verification (no price)")
            continue
        
        result = verify_prediction(pred, current_price)
        pred["status"] = result
        pred["result_price"] = int(current_price * 1_000_000)  # Store in micro-units
        pred["verified_at"] = datetime.utcnow().isoformat()
        
        emoji = "✅" if result == "won" else "❌"
        print(f"{emoji} {asset} {pred.get('direction')}: {result}")
        print(f"   Entry: ${pred.get('entry_price', 0) / 1_000_000:,.2f}")
        print(f"   Result: ${current_price:,.2f}")
        
        verified_count += 1
    
    save_predictions(predictions)
    return verified_count


def get_verification_stats() -> Dict:
    """Get verification statistics."""
    predictions = load_predictions()
    
    total = len(predictions)
    active = sum(1 for p in predictions if p.get("status") == "active")
    won = sum(1 for p in predictions if p.get("status") == "won")
    lost = sum(1 for p in predictions if p.get("status") == "lost")
    pending = sum(1 for p in predictions if p.get("status") in ["needs_verification", "needs_manual_verification"])
    
    win_rate = won / (won + lost) * 100 if (won + lost) > 0 else 0
    
    return {
        "total": total,
        "active": active,
        "won": won,
        "lost": lost,
        "pending_verification": pending,
        "win_rate": f"{win_rate:.1f}%",
    }


def main():
    """Main verifier loop."""
    print("🔍 Alpha Oracle Verifier")
    print("=" * 40)
    
    # Process expired predictions
    verified = process_expired_predictions()
    print(f"\n📊 Verified {verified} predictions")
    
    # Show stats
    stats = get_verification_stats()
    print(f"""
📈 Verification Stats:
├─ Total: {stats['total']}
├─ Active: {stats['active']}
├─ Won: {stats['won']}
├─ Lost: {stats['lost']}
├─ Pending: {stats['pending_verification']}
└─ Win Rate: {stats['win_rate']}
""")


if __name__ == "__main__":
    main()
