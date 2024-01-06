import { TransactionSummary } from "ynab";

const ynab = require("ynab");

export function getApi() {

  const accessToken = "CPB2N9Yy51oKN5i7SlQ4_a0a3WGXmdtpuEIeqY1DWVs";

  const API_KEY = process.env.YNAB_API_ACCESS_TOKEN || accessToken;
  if (API_KEY == null || API_KEY == "") {
    console.warn("You will need to define the YNAB_API_ACCESS_TOKEN environment variable.");
    process.exit(1);
  }

  const ynabAPI = new ynab.API(API_KEY);

  return ynabAPI;
}

// This function returns true if the dest transaction has a higher server knowledge than the origin transaction
// This means that the dest transaction has been updated after the origin transaction
// Also, if the origin transaction has no server knowledge, it means that it has been created by a old version adn we are going to update it
export function compareServerKnowledge(currentServerKnowledge: number, origin: TransactionSummary, printInfo = false): boolean {
  const originKnowledge = parseInt(origin.memo?.split("@")[1] || "-1");

  if (originKnowledge === -1 || isNaN(originKnowledge)) {
    return true;
  }
  const result = currentServerKnowledge > originKnowledge;
  if (result) {
    if (printInfo) console.log(`Transaction ${origin.id} is not up to date`);
  }
  return result;
}

export function printWithError(condition: boolean, name: string) {
  if (!condition) {
      console.log(`❌ ${name}`);
  } else {
      console.log(`✅ ${name}`);
  }
}


export interface DateRange {
  start: Date;
  end: Date;
}


export function getDateRange(month: string): DateRange {
  
  // Check the month is in the format yyyy-MM-dd
  const isMonthValid = /^\d{4}-\d{2}-\d{2}$/.test(month);
  if (!isMonthValid) {
    throw new Error("The month must be in the format yyyy-MM-dd");
  }
  const date = new Date(month);
  if (date.getTime() > Date.now()) {
    throw new Error("The month must be in the past");
  }

  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  return {
    start: startOfMonth,
    end: endOfMonth
  }

};