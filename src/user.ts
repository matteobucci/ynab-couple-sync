import { BudgetDetail, TransactionDetail, TransactionSummary } from "ynab";
import { YNABClient } from "./api/ynab";
import { AccountData, UserData } from "./model/user";
import { StateManager } from "./state_manager";
import { DateRange } from "./utils";


interface Categories {
    sharedCategoryGroupId: string;
    sharedCategoryId: string;
    sharedCategoryBalancingId: string;
}

interface SavedState {
    transactions?: number;
    sharedExpenses?: number
    categories?: Categories;
}

export class YNABAgent<T extends AccountData> {

    budgetCache?: Promise<{ budget: BudgetDetail, serverKnowledge: number }>;
    serverKnowledge?: number;
    budgetTime?: number;
    verbose = false;

    constructor(protected ynabAPI: YNABClient, public config: T) { }




    async fetchBudget(): Promise<{ budget: BudgetDetail, serverKnowledge: number }> {

        if (!this.budgetCache ){ //|| this.budgetTime && Date.now() - this.budgetTime < 60 * 1000) {

            this.budgetTime = Date.now();

            this.budgetCache = this.ynabAPI.getBudgetById(this.config.budgetId).then((result) => {
                if (!result?.data?.budget) {
                    throw(`${this.config.name} - Budget not found`);
                } else {
                    this.serverKnowledge = result?.data?.server_knowledge || -1;
                    return({ budget: result?.data?.budget, serverKnowledge: this.serverKnowledge });
                }
            });
        }

        return this.budgetCache;
    }

    async getTransactionsSummary(): Promise<TransactionSummary[]> {
        return (await this.fetchBudget())?.budget.transactions || [];
    }

    logVerbose(message: string, ...optionalParams: any[]) {
        if (this.verbose) {
            this.logVerbose(`${this.config.name} - ${message}`, ...optionalParams);
        }
    }

}



export class User extends YNABAgent<UserData>{

    state: SavedState = {};
    otherUser?: User;

    constructor(ynabAPI: YNABClient, config: UserData, private stateManager: StateManager<SavedState>) {
        super(ynabAPI, config);
    }

    saveState() {
        return this.stateManager.setSavedState(this.state);
    }

    // TODO: Give the possibility to refresh the categories
    async init(forceCategoryUpdate = false) {

        const savedState = await this.stateManager.getSavedState();
        if (!savedState) {
            this.logVerbose(`${this.config.name} - Initializing user`);
        } else {
            this.logVerbose(`${this.config.name} - Resuming user from state ${JSON.stringify(savedState)}`);
        }
        this.state = savedState || {};

        if (savedState?.categories && !forceCategoryUpdate) {
            this.state.categories = savedState.categories;
            this.logVerbose(`${this.config.name} - Categories already initialized`);
        } else {

            if (!forceCategoryUpdate) {
                this.logVerbose(`${this.config.name} - Forced refresh of categories`);
            }

            const budget = (await this.fetchBudget()).budget;
            const sharedCategory = budget.categories?.find((c) => c.name.includes(this.config.sharedCategoryName) && !c.name.includes(this.config.sharedCategoryBalancingName));
            const sharedBalancingCategory = budget.categories?.find((c) => c.name.includes(this.config.sharedCategoryBalancingName));

            if (!sharedCategory) {
                throw new Error(`${this.config.name} - Shared category not found`);
            }

            if (!sharedBalancingCategory) {
                throw new Error(`${this.config.name} - Shared balancing category not found`);
            }

            this.state.categories = {
                sharedCategoryGroupId: sharedCategory.category_group_id,
                sharedCategoryId: sharedCategory.id,
                sharedCategoryBalancingId: sharedBalancingCategory.id
            }

            this.logVerbose("Categories initialized for user ", this.config.name)
        }


    }

    async getLatestTransactions(): Promise<TransactionSummary[]> {
        const transactions1 = await this.getTransactionsSummary();
        return transactions1;
    }

    async getLatestTransactionFilteredByYear(year: number): Promise<TransactionSummary[]> {
        const transactions = await this.getLatestTransactions();
        return transactions.filter((t) => new Date(t.date).getFullYear() === year);
    }

    async getLatestTransactionsFilteredByMonth(dateRange: DateRange): Promise<TransactionSummary[]>{
        const transactions = await this.getLatestTransactions();
        return transactions.filter((t) => {
            const date = new Date(t.date);
            return date.getTime() > dateRange.start.getTime() && date.getTime() < dateRange.end.getTime();
        });
    }

    filterSharedExpenses(transactions: TransactionSummary[]): TransactionSummary[] {
        return transactions.filter((t) => t.category_id === this.state.categories?.sharedCategoryId);
    }

    filterOtherTypes(transactions: TransactionSummary[]): TransactionSummary[] {
        return transactions.filter((t) => t.category_id !== this.state.categories?.sharedCategoryId && t.category_id !== this.state.categories?.sharedCategoryBalancingId);
    }

    filterSharedExpensesBalancing(transactions: TransactionSummary[]): TransactionSummary[] {
        // I need to filter balancing transactions that are created as result of a transfer
        return transactions.filter((t) => t.category_id === this.state.categories?.sharedCategoryBalancingId && !t.memo?.includes("@"));
    }

    async addTransferTransaction(originalTransaction: TransactionSummary): Promise<TransactionSummary> {

        const newTransaction = {
            category_id: this.state.categories?.sharedCategoryBalancingId,
            memo: originalTransaction.id + " " + "@ " + (originalTransaction.memo || ""),
            cleared: originalTransaction.cleared,
            approved: true,
            flag_color: originalTransaction.flag_color,
            amount: originalTransaction.amount * -1,
            date: originalTransaction.date,
            account_id: this.config.balancingBankAccountId
        };

        try {

            const createdTransaction = await this.ynabAPI.createTransaction(this.config.budgetId, { transaction: newTransaction });

            if (!createdTransaction?.data.transaction) {
                throw new Error(`${this.config.name} - Could not create transaction for ${originalTransaction.id}`)
            }

            return createdTransaction.data.transaction;
        } catch (e) {
            console.error(`${this.config.name} - Error while creating transaction for ${originalTransaction.id}`, e)
            throw e;
        }

    }

    async updateTransferTransaction(originalTransaction: TransactionDetail, transferTransactionId: string): Promise<TransactionDetail> {

        const newTransaction = {
            category_id: this.state.categories?.sharedCategoryBalancingId,
            memo: originalTransaction.id + " " + "@ " + (originalTransaction.memo || ""),
            cleared: originalTransaction.cleared,
            approved: true,
            flag_color: originalTransaction.flag_color,
            amount: originalTransaction.amount * -1,
            date: originalTransaction.date,
            account: this.config.balancingBankAccountId
        };

        const updatedTransaction = await this.ynabAPI.updateTransaction(this.config.budgetId, transferTransactionId, { transaction: newTransaction });

        if (!updatedTransaction?.data.transaction) {
            throw new Error(`${this.config.name} - Could not update transaction for ${originalTransaction.id}`)
        }

        return updatedTransaction.data.transaction;


    }




}




// Node API currently doesn't support category groups
// const sharedCategoryGroup = budget.category_groups.find((cg) => cg.name.includes(sharedAccountGroupName));

// if(!sharedCategoryGroup) {
//     this.logVerbose(budgetName, "Creating shared category group");
//     const newCategoryGroup = {
//         name: sharedAccountGroupName,
//         hidden: false
//     };


//     ynabAPI.budgets.withPostMiddleware
//     sharedCategoryGroup = await ynabAPI.categories.createCategoryGroup(budget.id, newCategoryGroup);
// }
