// Usage: npm run seed  (wipes the database and reloads seed/*.json)
import "dotenv/config";
import { openDb, seed } from "./db.js";

const reset = process.argv.includes("--reset");
const counts = seed(openDb(), { reset });
console.log(`Loaded ${counts.opps} opportunities and ${counts.products} products${reset ? " (database reset)" : ""}.`);
