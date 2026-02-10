#!/usr/bin/env python3
"""
Alpha Oracle — Nansen Smart Money Integration
Fetches smart money signals from Nansen API to generate enhanced predictions.
"""

import json
import time
import requests
from datetime import datetime, timezone
from pathlib import Path

SECRETS_PATH = Path.home() / "clawd" / ".secrets" / "nansen-api.json"
OUTPUT_PATH = Path.home() / "clawd" / "hackathon" / "alpha-oracle" / "client" / "nansen_signals.json"

# Token address mapping (major tokens on supported chains)
TOKEN_MAP = {
    # Ethereum
    "ETH": {"chain": "ethereum", "address": "ETH"},
    "UNI": {"chain": "ethereum", "address": "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"},
    "AAVE": {"chain": "ethereum", "address": "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"},
    "LINK": {"chain": "ethereum", "address": "0x514910771af9ca656af840dff83e8264ecf986ca"},
    # Solana
    "SOL": {"chain": "solana", "address": "SOL"},
    # BSC
    "BNB": {"chain": "bsc", "address": "BNB"},
    # Multi-chain tokens
    "VIRTUAL": {"chain": "base", "address": "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b"},
}

# Chains to scan for smart money netflow
CHAINS_TO_SCAN = ["ethereum", "solana", "base", "arbitrum"]


def load_config():
    with open(SECRETS_PATH) as f:
        return json.load(f)


def nansen_post(endpoint: str, body: dict, api_key: str) -> dict:
    """Make a POST request to Nansen API."""
    url = f"https://api.nansen.ai/api/v1{endpoint}"
    headers = {"apiKey": api_key, "Content-Type": "application/json"}
    
    resp = requests.post(url, json=body, headers=headers, timeout=30)
    if resp.status_code == 429:
        print("⚠️  Rate limited, waiting 2s...")
        time.sleep(2)
        resp = requests.post(url, json=body, headers=headers, timeout=30)
    
    resp.raise_for_status()
    return resp.json()


def get_smart_money_netflow(api_key: str, chain: str) -> list:
    """Get smart money net inflows/outflows for a chain (paginated)."""
    all_data = []
    for page in range(1, 4):  # Up to 3 pages (30 tokens)
        try:
            data = nansen_post("/smart-money/netflow", {
                "chains": [chain], "pagination": {"page": page, "per_page": 10}
            }, api_key)
            items = data.get("data", [])
            all_data.extend(items)
            pag = data.get("pagination", {})
            if str(pag.get("is_last_page", "True")).lower() == "true":
                break
            time.sleep(1.1)
        except Exception as e:
            print(f"  ❌ {chain} netflow p{page} error: {e}")
            break
    return all_data


def get_smart_money_dex_trades(api_key: str, chain: str) -> list:
    """Get recent smart money DEX trades (paginated)."""
    all_data = []
    for page in range(1, 4):
        try:
            data = nansen_post("/smart-money/dex-trades", {
                "chains": [chain], "pagination": {"page": page, "per_page": 10}
            }, api_key)
            items = data.get("data", [])
            all_data.extend(items)
            pag = data.get("pagination", {})
            if str(pag.get("is_last_page", "True")).lower() == "true":
                break
            time.sleep(1.1)
        except Exception as e:
            print(f"  ❌ {chain} dex-trades p{page} error: {e}")
            break
    return all_data


def get_token_flows(api_key: str, chain: str, token_address: str) -> dict:
    """Get token-specific flow data."""
    try:
        data = nansen_post("/token/flows", {
            "chains": [chain],
            "tokenAddress": token_address
        }, api_key)
        return data.get("data", data.get("result", {}))
    except Exception as e:
        print(f"  ❌ token flows error: {e}")
        return {}


def analyze_netflows(all_netflows: dict) -> list:
    """Analyze netflow data across chains to find strong signals."""
    signals = []
    
    for chain, flows in all_netflows.items():
        if not flows or not isinstance(flows, list):
            continue
        
        for token_flow in flows:
            symbol = token_flow.get("token_symbol", "")
            # Use 24h netflow as primary signal
            net_flow_24h = float(token_flow.get("net_flow_24h_usd", 0) or 0)
            net_flow_1h = float(token_flow.get("net_flow_1h_usd", 0) or 0)
            net_flow_7d = float(token_flow.get("net_flow_7d_usd", 0) or 0)
            mcap = float(token_flow.get("market_cap_usd", 0) or 0)
            trader_count = int(token_flow.get("trader_count", 0) or 0)
            
            if not symbol:
                continue
            
            # Use 24h flow, but boost if 1h agrees
            primary_flow = net_flow_24h
            if not primary_flow:
                primary_flow = net_flow_1h
            
            if not primary_flow:
                continue
            
            # Signal strength: flow relative to mcap (if available)
            flow_pct = abs(primary_flow) / mcap * 100 if mcap > 0 else 0
            
            # Any meaningful flow from smart money is a signal
            # Lower threshold since these are already filtered to smart money
            if abs(primary_flow) > 5000 or flow_pct > 0.1:
                direction = "LONG" if primary_flow > 0 else "SHORT"
                
                # Confidence based on: flow size, multiple traders, 1h/24h agreement
                conf = 0.3
                if abs(primary_flow) > 50000: conf += 0.2
                if abs(primary_flow) > 200000: conf += 0.2
                if trader_count >= 3: conf += 0.1
                if (net_flow_1h > 0) == (net_flow_24h > 0) and net_flow_1h != 0: conf += 0.1
                if (net_flow_7d > 0) == (net_flow_24h > 0) and net_flow_7d != 0: conf += 0.1
                conf = min(conf, 1.0)
                
                signals.append({
                    "symbol": symbol.upper(),
                    "chain": chain,
                    "direction": direction,
                    "net_flow_usd": round(primary_flow, 2),
                    "net_flow_1h_usd": round(net_flow_1h, 2),
                    "net_flow_7d_usd": round(net_flow_7d, 2),
                    "market_cap_usd": round(mcap, 0),
                    "flow_pct_mcap": round(flow_pct, 4),
                    "trader_count": trader_count,
                    "confidence": round(conf, 2),
                    "source": "nansen_smart_money_netflow",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })
    
    signals.sort(key=lambda x: abs(x["net_flow_usd"]), reverse=True)
    return signals


def analyze_dex_trades(all_trades: dict) -> list:
    """Analyze DEX trades to find accumulation/distribution patterns."""
    signals = []
    token_agg = {}
    
    for chain, trades in all_trades.items():
        if not trades or not isinstance(trades, list):
            continue
        
        for trade in trades:
            # Nansen DEX trades have token_bought_symbol and token_sold_symbol
            bought = trade.get("token_bought_symbol", "")
            sold = trade.get("token_sold_symbol", "")
            usd_value = float(trade.get("trade_value_usd", 0) or 0)
            
            if not usd_value:
                continue
            
            # Track bought token as "buy", sold token as "sell"
            # Skip stablecoins as targets
            stables = {"USDC", "USDT", "DAI", "BUSD", "WETH", "WBTC", "WBNB", "WSOL"}
            
            if bought and bought.upper() not in stables:
                key = f"{bought.upper()}_{chain}"
                if key not in token_agg:
                    token_agg[key] = {"symbol": bought.upper(), "chain": chain, "buys": 0, "sells": 0, "trades": 0}
                token_agg[key]["buys"] += usd_value
                token_agg[key]["trades"] += 1
            
            if sold and sold.upper() not in stables:
                key = f"{sold.upper()}_{chain}"
                if key not in token_agg:
                    token_agg[key] = {"symbol": sold.upper(), "chain": chain, "buys": 0, "sells": 0, "trades": 0}
                token_agg[key]["sells"] += usd_value
                token_agg[key]["trades"] += 1
    
    for key, agg in token_agg.items():
        total = agg["buys"] + agg["sells"]
        if total < 5000:
            continue
        
        net = agg["buys"] - agg["sells"]
        buy_ratio = agg["buys"] / total if total > 0 else 0.5
        
        # Any imbalance is interesting for smart money
        if buy_ratio > 0.6 or buy_ratio < 0.4:
            direction = "LONG" if net > 0 else "SHORT"
            confidence = min(abs(buy_ratio - 0.5) * 2 + 0.2, 1.0)
            if agg["trades"] >= 3: confidence = min(confidence + 0.1, 1.0)
            
            signals.append({
                "symbol": agg["symbol"],
                "chain": agg["chain"],
                "direction": direction,
                "net_flow_usd": round(net, 2),
                "buy_ratio": round(buy_ratio, 3),
                "total_volume_usd": round(total, 2),
                "trade_count": agg["trades"],
                "confidence": round(confidence, 2),
                "source": "nansen_smart_money_dex",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
    
    signals.sort(key=lambda x: abs(x.get("net_flow_usd", 0)), reverse=True)
    return signals


def merge_signals(netflow_signals: list, dex_signals: list) -> list:
    """Merge and deduplicate signals from different sources."""
    merged = {}
    
    for sig in netflow_signals + dex_signals:
        key = sig["symbol"]
        if key not in merged:
            merged[key] = {
                "symbol": sig["symbol"],
                "chain": sig["chain"],
                "direction": sig["direction"],
                "confidence": sig["confidence"],
                "sources": [sig["source"]],
                "net_flow_usd": sig["net_flow_usd"],
                "timestamp": sig["timestamp"]
            }
        else:
            existing = merged[key]
            existing["sources"].append(sig["source"])
            # If both sources agree on direction, boost confidence
            if existing["direction"] == sig["direction"]:
                existing["confidence"] = min(existing["confidence"] + 0.2, 1.0)
            else:
                # Conflicting signals — reduce confidence
                existing["confidence"] = max(existing["confidence"] - 0.3, 0.1)
            existing["net_flow_usd"] += sig["net_flow_usd"]
    
    result = list(merged.values())
    result.sort(key=lambda x: x["confidence"], reverse=True)
    return result


def main():
    print("🔮 Alpha Oracle — Nansen Smart Money Scanner")
    print("=" * 50)
    
    config = load_config()
    api_key = config["api_key"]
    
    # 1. Fetch smart money netflows across chains
    print("\n📊 Fetching smart money netflows...")
    all_netflows = {}
    for chain in CHAINS_TO_SCAN:
        print(f"  → {chain}...")
        all_netflows[chain] = get_smart_money_netflow(api_key, chain)
        time.sleep(1.1)  # Rate limit: 1/sec
    
    # 2. Fetch smart money DEX trades
    print("\n💱 Fetching smart money DEX trades...")
    all_dex_trades = {}
    for chain in CHAINS_TO_SCAN:
        print(f"  → {chain}...")
        all_dex_trades[chain] = get_smart_money_dex_trades(api_key, chain)
        time.sleep(1.1)
    
    # 3. Analyze
    print("\n🧠 Analyzing signals...")
    netflow_signals = analyze_netflows(all_netflows)
    print(f"  Netflow signals: {len(netflow_signals)}")
    
    dex_signals = analyze_dex_trades(all_dex_trades)
    print(f"  DEX trade signals: {len(dex_signals)}")
    
    # 4. Merge
    merged = merge_signals(netflow_signals, dex_signals)
    print(f"  Merged signals: {len(merged)}")
    
    # 5. Output
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "nansen_smart_money",
        "chains_scanned": CHAINS_TO_SCAN,
        "signals": merged[:20],  # Top 20
        "raw_stats": {
            "netflow_signals": len(netflow_signals),
            "dex_signals": len(dex_signals),
            "merged_total": len(merged)
        }
    }
    
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n💾 Saved to {OUTPUT_PATH}")
    
    # Print top signals
    if merged:
        print("\n🏆 TOP SMART MONEY SIGNALS:")
        for i, sig in enumerate(merged[:10], 1):
            arrow = "🟢" if sig["direction"] == "LONG" else "🔴"
            flow_str = f"${abs(sig['net_flow_usd']):,.0f}" if sig['net_flow_usd'] else "N/A"
            sources = "+".join(s.replace("nansen_smart_money_", "") for s in sig["sources"])
            print(f"  {i}. {arrow} {sig['direction']} {sig['symbol']} ({sig['chain']}) "
                  f"| Flow: {'+' if sig['net_flow_usd'] > 0 else '-'}{flow_str} "
                  f"| Conf: {sig['confidence']:.0%} | Sources: {sources}")
    else:
        print("\n⚠️  No strong signals found")
    
    return output


if __name__ == "__main__":
    main()
