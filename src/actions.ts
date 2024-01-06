import { BudgetDetail, SaveTransaction, TransactionSummary } from "ynab";
import { SharedAccount } from "./shared_account";
import { User } from "./user";
import { getDateRange, printWithError } from "./utils";


export class Actions {

    constructor(private users: User[], private sharedAccount: SharedAccount) {

    }

    async runForEachUser(callback: (user: User) => Promise<void>) {
        await Promise.all(
            this.users.map(async (user) => {
                await callback(user);
            })
        );
    }

    async runForEchMonth(budget: BudgetDetail, callback: (month: string) => Promise<void>) {

        if (!budget?.months) {
            throw new Error("Could not find months in budget");
        }

        await Promise.all(
            budget?.months?.map(async (month) => {
                console.log(`Processing month ${month.month}`);
                await callback(month.month);
            })
        );

    }



    async syncAll() {

        await this.runForEachUser(async (user) => {

            const budgetData = await user.fetchBudget();
            const serverKnowledge = budgetData.serverKnowledge;

           // await this.syncMultipleMonths(user, budgetData, serverKnowledge, budgetData.budget.months?.map((m) => m.month) || []);

            await this.runForEchMonth(budgetData.budget, async (month) => {
                // Sync transactions
                await this.syncMonth(user, month);
          //      const { total } = this.getUserBudgetedInShared(budgetData.budget, month, user);
                // Sync allocated budget
             //   await this.sharedAccount.checkAllocatedBudgetForAGivenMonth(month, total, user.config.sharedBudgetPrivateBankAccountId, serverKnowledge);

                console.log(`Syncing ${user.config.name} for month ${month} completed`);
            });

            console.log(`Syncing ${user.config.name} completed`);

        });

    };

    async syncMultipleMonths(user: User, budgetData: any, serverKnoledge: number, months: string[]) {

        const aggregatedResult: { toCreate: SaveTransaction[], toUpdate: SaveTransaction[] } = {toCreate:[], toUpdate: []};
        
        for(let month of months){
            const { total } = this.getUserBudgetedInShared(budgetData.budget, month, user);
            const result = await this.sharedAccount.checkAllocatedBudgetForAGivenMonth(month, total, user.config.sharedBudgetPrivateBankAccountId, serverKnoledge);

            aggregatedResult.toCreate.push(...result.toCreate);
            aggregatedResult.toUpdate.push(...result.toUpdate);

        }
             
        console.log(`Syncing ${user.config.name} for months ${months.join(',')} completed. Created ${aggregatedResult.toCreate.length} transactions and updated ${aggregatedResult.toUpdate.length} transactions`);
        
        await this.sharedAccount.ynabClient.createTransactions(user.config.sharedBudgetPrivateBankAccountId, { transactions: aggregatedResult.toCreate });

        console.log(`Creation done`);

        await this.sharedAccount.ynabClient.updateTransactions(user.config.sharedBudgetPrivateBankAccountId, { transactions: aggregatedResult.toUpdate });
    
        console.log(`Syncing ${user.config.name} for months ${months.join(',')} completed. Created ${aggregatedResult.toCreate.length} transactions and updated ${aggregatedResult.toUpdate.length} transactions`);

    }

    // TODO: So far it checks only the first user
    async checkMonthStatus(user: User) {

        const sharedBudget = (await this.sharedAccount.fetchBudget()).budget;
        const budgetData = await user.fetchBudget();
        const userBudget = budgetData.budget;
        const serverKnoledge = budgetData.serverKnowledge;
        const bankAccountId = user.config.sharedBudgetPrivateBankAccountId;

        console.log(`${user.config.name} - Latest server knowledge: ${serverKnoledge}`);

        // First check: is Shared Expenses category present?
        const sharedCategory = userBudget.categories?.find((c) => c.name.includes(user.config.sharedCategoryName) && !c.name.includes(user.config.sharedCategoryBalancingName));
        const balancing = userBudget.categories?.find((c) => c.name.includes(user.config.sharedCategoryBalancingName));

        printWithError(!!sharedCategory, 'Shared Expenses');
        printWithError(!!balancing, 'Balancing');

        for (let month of (budgetData.budget.months || [])) {

            const { total} = this.getUserBudgetedInShared(budgetData.budget, month.month, user);

            const transaction = await this.sharedAccount.findTransactionInSharedBudget(month.month, bankAccountId);

            if (transaction) {
                const amountsAreEqual = transaction.amount === total;
                printWithError(amountsAreEqual, `Budgeted for ${month.month}: amounts are equal`);
            } else {
                printWithError(false, `Budgeted ${month.month}: missing transaction`);
            }

        }

        const allSharedTransactions = userBudget.transactions;

        if (allSharedTransactions) {
            const allSharedExpenses = user.filterSharedExpenses(allSharedTransactions);
            const allBalancing = user.filterSharedExpensesBalancing(allSharedTransactions);
            const allOtherTypes = user.filterOtherTypes(allSharedTransactions);

            const allUserSharedTransactions = sharedBudget.transactions?.filter((t) => t.account_id === bankAccountId);

            console.log(`${user.config.name} - Found ${allSharedExpenses.length} shared expenses transactions`);
            console.log(`${user.config.name} - Found ${allUserSharedTransactions?.length} transactions in shared budget`);

            let missingTransactions = 0;
            let wrongAmountTransactions = 0;
            let correctTransactions = 0;

            for (let transaction of allSharedExpenses) {
                const foundTransaction = allUserSharedTransactions?.find((t) => t.memo?.includes(transaction.id || ""));
                if (!foundTransaction) {
                    missingTransactions++;
                } else {
                    correctTransactions++;
                }
            }

            console.log(`Found ${correctTransactions} out of ${allSharedExpenses.length} transactions`);
            console.log(`${user.config.name} - Found ${allBalancing.length} balancing transactions`);
            console.log(`${user.config.name} - Found ${allOtherTypes.length} other types transactions`);

        }

    }


    async checkMonthAllocatedBalance() {
        const sharedBudget = (await this.sharedAccount.fetchBudget()).budget;

        for (let user of this.users) {

            const budgetData = await user.fetchBudget();
            const userBudget = budgetData.budget;
            const serverKnoledge = budgetData.serverKnowledge;

            for (let month of (userBudget.months || [])) {

                // Date check to avoid future months
                const date = new Date(month.month);
                if (date.getTime() > Date.now()) {
                    console.log(`${user.config.name} - Skipping future month ${month.month}`);
                    continue;
                }

                console.log(`${user.config.name} - Checking month ${month.month}`);

                try {
                    const { sharedBudgeted, balanceBudgeted, total, sharedCategory, balancing } = this.getUserBudgetedInShared(userBudget, month.month, user);
                    console.log(`${user.config.name} - ${sharedCategory.name} has ${sharedBudgeted} budgeted`);
                    console.log(`${user.config.name} - ${balancing.name} has ${balanceBudgeted} budgeted`);

                    console.log(`${user.config.name} - Month ${month.month} for ${total} budgeted`);

                    await this.sharedAccount.checkAllocatedBudgetForAGivenMonth(month.month, total, user.config.sharedBudgetPrivateBankAccountId, serverKnoledge);

                } catch (e: any) {
                    console.log(`Some error occurred for the month ${month.month}`, e.message);
                }

            }
        }
    }

    getUserBudgetedInShared(userBudget: BudgetDetail, month: string, user: User) {
        const budgetMonth = userBudget.months?.find((m) => m.month === month);

        if (!budgetMonth) {
            throw new Error(`${user.config.name} - Could not find month ${month} in budget of user `);
        }

        const sharedCategory = budgetMonth.categories?.find((c) => c.name.includes(user.config.sharedCategoryName) && !c.name.includes(user.config.sharedCategoryBalancingName));
        const balancing = budgetMonth.categories?.find((c) => c.name.includes(user.config.sharedCategoryBalancingName));

        if (!sharedCategory) {
            throw new Error(`${user.config.name} - Could not find shared category ${user.config.sharedCategoryName} in budget of user `);
        }

        if (!balancing) {
            throw new Error(`${user.config.name} - Could not find shared category ${user.config.sharedCategoryBalancingName} in budget of user `);
        }

        const sharedBudgeted = sharedCategory.budgeted || 0;
        const balanceBudgeted = balancing.budgeted || 0;
        const total = sharedBudgeted + balanceBudgeted;


        return {
            sharedBudgeted,
            balanceBudgeted,
            sharedCategory,
            balancing,
            total
        }
    }

    async syncAllInOneGo(user: User){

        const transactions = await user.getLatestTransactions();

        if(!transactions || transactions.length === 0){
            return;
        }

        const serverKnowledge = (await user.fetchBudget()).serverKnowledge;
        await this.processSharedExpensesTransactions(transactions, user, serverKnowledge);
        await this.processBalancingTransactions(transactions, user, serverKnowledge);
        await this.processOtherTransactions(transactions, user, serverKnowledge);

    }

    async syncYearInOneGo(user: User, year: number){
        
        const transactions = await user.getLatestTransactionFilteredByYear(year);

        if(!transactions || transactions.length === 0){
            return;
        }

        const serverKnowledge = (await user.fetchBudget()).serverKnowledge;
        await this.processSharedExpensesTransactions(transactions, user, serverKnowledge);
        await this.processBalancingTransactions(transactions, user, serverKnowledge);
        await this.processOtherTransactions(transactions, user, serverKnowledge);

    }

    async syncMonth(user: User, month: string) {

        const transactions = await user.getLatestTransactionsFilteredByMonth(getDateRange(month));

        if(!transactions || transactions.length === 0){
            return;
        }

        const serverKnowledge = (await user.fetchBudget()).serverKnowledge;

        await this.processSharedExpensesTransactions(transactions, user, serverKnowledge);

        await this.processBalancingTransactions(transactions, user, serverKnowledge);

        await this.processOtherTransactions(transactions, user, serverKnowledge);
    }

    async loopPaymentsSync() {
        let counter = 0;

        while (true) {

            counter++;
            console.log(`Checking ${counter} time`);

            if (counter === 1) {
                // First time we just process shared expenses
                console.log(`First time, changes of category will not be detected`);
            }

            for (let user of this.users) {

                const serverKnowledge = (await user.fetchBudget()).serverKnowledge;

                let transactions = await user.getLatestTransactions();
                console.log(`${user.config.name} - Found ${transactions.length} transactions`);

                transactions = transactions.filter((t) => {
                    const date = new Date(t.date);
                    const firstOfDecember = new Date("2023-12-01");
                    return date.getTime() > firstOfDecember.getTime();
                });

                console.log(`${user.config.name} - Found ${transactions.length} transactions after 1st of November`);

                if (transactions && transactions.length > 0) {


                    await this.processSharedExpensesTransactions(transactions, user, serverKnowledge);
                    await this.processBalancingTransactions(transactions, user, serverKnowledge);
                    await this.processOtherTransactions(transactions, user, serverKnowledge);

                }

            }

            // Simply wait for 10 seconds
            console.log("Waiting for 10 seconds");
            await new Promise((resolve) => setTimeout(resolve, 10000));

        }
    }

    private async processBalancingTransactions(transactions: TransactionSummary[], user: User, serverKnowledge: number) {
        const balancingTransactions = user.filterSharedExpensesBalancing(transactions);
        const source = user;
        const dest = user.otherUser;
        if (!dest) {
            throw new Error("Error when creating a balancing transaction. The other account has not been set");
        }
        await this.sharedAccount.processBalancingTransactions(source, dest, balancingTransactions, serverKnowledge);
    }

    private async processSharedExpensesTransactions(transactions: TransactionSummary[], user: User, serverKnowledge: number) {
        const sharedCategoryTransactions = user.filterSharedExpenses(transactions);
        await this.sharedAccount.processSharedExpensesTransactions(user.config.sharedBudgetPrivateBankAccountId, sharedCategoryTransactions, serverKnowledge);
    }

    private async processOtherTransactions(transactions: TransactionSummary[], user: User, serverKnowledge: number) {
        const otherTypesTransaction = user.filterOtherTypes(transactions);
        await this.sharedAccount.processOtherTypesTransactions(otherTypesTransaction);
    }


}

