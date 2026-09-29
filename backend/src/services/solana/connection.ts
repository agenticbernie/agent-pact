import { Connection, PublicKey } from "@solana/web3.js";
import { getConfig } from "../../config/env";

let connection: Connection | undefined;

/** Lazily-created singleton Connection. */
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(getConfig().solana.rpcUrl, "confirmed");
  }
  return connection;
}

/** Configured USDC mint (devnet default). */
export function usdcMint(): PublicKey {
  return new PublicKey(getConfig().solana.usdcMint);
}
