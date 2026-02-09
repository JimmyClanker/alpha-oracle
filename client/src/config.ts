import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

// Program ID from the deployed program
export const PROGRAM_ID = new PublicKey("BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV");

// RPC URLs
export const DEVNET_RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Price precision (6 decimals)
export const PRICE_DECIMALS = 6;
export const PRICE_MULTIPLIER = 10 ** PRICE_DECIMALS;

// Paths
export const WALLET_PATH = path.join(process.env.HOME || "", ".config/solana/jimmy-solana.json");
export const IDL_PATH = path.join(import.meta.dirname, "../../target/idl/alpha_oracle.json");
export const SIGNALS_PATH = "/Users/clanker/clawd/trading/current_signals.json";

export function loadKeypair(filepath: string = WALLET_PATH): Keypair {
  const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

export function loadIdl() {
  return JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
}

export function getProvider(keypair?: Keypair): AnchorProvider {
  const kp = keypair || loadKeypair();
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = new Wallet(kp);
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function getProgram(provider?: AnchorProvider): Program {
  const prov = provider || getProvider();
  const idl = loadIdl();
  return new Program(idl, prov);
}

// PDA derivation helpers
export function getOraclePDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), authority.toBuffer()],
    PROGRAM_ID
  );
}

export function getPredictionPDA(oracle: PublicKey, predictionId: bigint | number): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(predictionId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("prediction"), oracle.toBuffer(), idBuf],
    PROGRAM_ID
  );
}

export function priceToU64(price: number): bigint {
  return BigInt(Math.round(price * PRICE_MULTIPLIER));
}

export function u64ToPrice(value: bigint | number): number {
  return Number(value) / PRICE_MULTIPLIER;
}
