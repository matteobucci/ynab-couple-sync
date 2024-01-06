import { API, BudgetDetail, BudgetDetailResponse, GetTransactionsTypeEnum, PatchTransactionsWrapper, PostTransactionsWrapper, PutTransactionWrapper, TransactionSummary } from "ynab";
import { StateManager } from "../state_manager";

export interface YNABCalls {
    calls: number,
    currentHour: string
}

// This needs to be optimized with hourly refresh
export class YNABClient {

    private ynabAPI: API;

    private rateLimits: YNABCalls = {
        calls: 0,
        currentHour: `${new Date().getHours()}`
    };

    private  allPayeeCache: Map<string, string> = new Map();

    private callLogs: string[] = [];

    constructor(token: string, private stateManager: StateManager<YNABCalls>) {

        this.stateManager.getSavedState().then((numberOfCalls) => {

            if (numberOfCalls?.currentHour === `${new Date().getHours()}`) {
                console.log(`Using saved state with Number of calls: ${numberOfCalls.calls} and current hour: ${numberOfCalls.currentHour}`);
                this.rateLimits = numberOfCalls;
            }
            else {
                console.log(`Saved state with Number of calls: ${numberOfCalls?.calls} and current hour: ${numberOfCalls?.currentHour} is not valid for current hour: ${new Date().getHours()}`);
                this.rateLimits = {
                    calls: 0,
                    currentHour: `${new Date().getHours()}`
                }
            }

            console.log("Initializing YNAB API")
        });

        this.ynabAPI = new API(token);


    }

    getNumberOfCalls() {
        return {
            calls: this.rateLimits.calls,
            logs: this.callLogs
        };
    }

    async saveState() {
        await this.stateManager.setSavedState(this.rateLimits);
        console.log(`Number of API of calls so far in this hour: ${this.rateLimits.calls}`)
    }

    private increaseApiCalls(source: string = "unknown") {
        const currentHour = `${new Date().getHours()}`;
        if (currentHour !== this.rateLimits.currentHour) {
            console.log(`New hour: ${currentHour} - Resetting number of calls`);
            this.rateLimits = {
                calls: 0,
                currentHour
            };
        }
        this.rateLimits.calls++;
        console.log(`Calling ${source} - Number of calls: ${this.rateLimits.calls}`);
        this.callLogs.push(`${this.rateLimits.calls} | ${new Date().toISOString()} | ${source}`);
    }

    async getTransactions(budgetId: string, sinceDate?: string, type?: GetTransactionsTypeEnum, lastKnowledgeOfServer?: number) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls('getTransactions');
            return this.ynabAPI.transactions.getTransactions(budgetId, sinceDate, type, lastKnowledgeOfServer);
        });
    }

    async getBudgets() {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls('getBudgets');
            return this.ynabAPI.budgets.getBudgets();
        });
    }

    async getBudgetById(budgetId: string): Promise<BudgetDetailResponse> {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`getBudgetById(${budgetId})`);
            const budget = await this.ynabAPI.budgets.getBudgetById(budgetId);
            // Cache all payees
            budget?.data?.budget?.payees?.forEach((payee) => {
                this.allPayeeCache.set(payee.id, payee.name);
            });
            return budget;
        });

    }

    async updateTransaction(budgetId: string, transactionId: string, data: PutTransactionWrapper) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`updateTransaction(${budgetId}, ${transactionId})`);
            return this.ynabAPI.transactions.updateTransaction(budgetId, transactionId, data);
        });

    }

    async createTransaction(budgetId: string, data: PutTransactionWrapper) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`createTransaction(${budgetId})`);
            return this.ynabAPI.transactions.createTransaction(budgetId, data);
        });
    }

    async createTransactions(budgetId: string, data: PostTransactionsWrapper) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`createTransactions(${budgetId})`);
            return this.ynabAPI.transactions.createTransactions(budgetId, data);
        });
    }

    async updateTransactions(budgetId: string, data: PatchTransactionsWrapper) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`updateTransactions(${budgetId})`);
            return this.ynabAPI.transactions.updateTransactions(budgetId, data);
        });
    }

    async deleteTransaction(budgetId: string, transactionId: string) {
        return await this.runWithErrorHandler(async () => {
            this.increaseApiCalls(`deleteTransaction(${budgetId}, ${transactionId})`);
            return this.ynabAPI.transactions.deleteTransaction(budgetId, transactionId);
        });
    }


    resolvePayeeName(payeedID: string) {
        if (this.allPayeeCache.has(payeedID)) {
            return this.allPayeeCache.get(payeedID);
        } else {
            return "Unknown Payee";
        }
    }

    private commonErrorHandler(e: any) {
        console.log(e);
        throw e;
    }

    private async runWithErrorHandler(func: () => Promise<any>) {
        try {
            return await func();
        } catch (e) {
            this.commonErrorHandler(e);
        }
    }

}