import { SaveTransaction, TransactionDetail, TransactionFlagColor, TransactionSummary } from "ynab";
import { YNABClient } from "./api/ynab";
import { AccountData } from "./model/user";
import { User, YNABAgent } from "./user";
import { compareServerKnowledge } from "./utils";

export class SharedAccount extends YNABAgent<AccountData>{

  ynabClient: YNABClient;
  config: AccountData;

  payeeNames: Map<string, string> = new Map();

  constructor(ynabAPI: YNABClient, serviceConfiguration: AccountData) {
    super(ynabAPI, serviceConfiguration);

    this.ynabClient = ynabAPI;
    this.config = serviceConfiguration;

  }

  async processSharedExpensesTransactions(sharedBudgetPrivateBankAccountId: string, sharedExpenses: TransactionSummary[], serverKnowledge: number) {

    const { toCreate, toUpdate, toDelete } = await this.catalogExpensesActions(sharedExpenses, serverKnowledge);

    if (toCreate.length > 0) {
      const toCreateTransactions = toCreate.map((t) => this.createTransactionObject(t, sharedBudgetPrivateBankAccountId, serverKnowledge));
      const cretionResult = await this.ynabClient.createTransactions(this.config.budgetId, { transactions: toCreateTransactions });
      console.log("Transactions created", cretionResult?.data.transaction_ids?.length || 0);

    }

    if (toUpdate.length > 0) {
      const toUpdateTransactions = toUpdate.map(t => this.createTransactionObject(t.dest, sharedBudgetPrivateBankAccountId, serverKnowledge));
      const response = await this.ynabClient.updateTransactions(this.config.budgetId, { transactions: toUpdateTransactions });
      console.log("Transactions updated", response?.data.transaction_ids?.length || 0);
    }

    const toDeleteTransactions = toDelete.map((t) => {
      return t.id;
    });

    for (const t of toDeleteTransactions) {
      await this.ynabClient.deleteTransaction(this.config.budgetId, t)
    }

  }


  private async catalogExpensesActions(expenses: TransactionSummary[], serverKnowledge: number): Promise<{ toCreate: TransactionSummary[], toUpdate: { origin: TransactionSummary, dest: TransactionSummary }[], toDelete: TransactionSummary[] }> {
    const actions: { toCreate: TransactionSummary[], toUpdate: { origin: TransactionSummary, dest: TransactionSummary }[], toDelete: TransactionSummary[] } = {
      toCreate: [],
      toUpdate: [],
      toDelete: [],
    };

    for (const expense of expenses) {
      if (expense.deleted) {
        actions.toDelete.push(expense);
      } else {
        const existingTransaction = await this.findTransactionInSharedBudget(expense.id);

        if (existingTransaction && compareServerKnowledge(serverKnowledge, existingTransaction)) {
          actions.toUpdate.push({ origin: existingTransaction, dest: expense });
        } else if (!existingTransaction) {
          actions.toCreate.push(expense);
        }
      }
    }

    console.log("Expenses to create", actions.toCreate.length);
    console.log("Expenses to update", actions.toUpdate.length);
    console.log("Expenses to delete", actions.toDelete.length);

    return actions;
  }

  private createMemoForTransaction(transaction: TransactionSummary, originalServerKnowledge: number) {
    return `${transaction.id}@${originalServerKnowledge} | ${transaction.memo || ""}`
  }


  async processOtherTypesTransactions(otherTypesTransactions: TransactionSummary[]) {
    for (const otherTypesTransaction of otherTypesTransactions) {
      await this.checkAndEventuallyDeleteSharedExpense(otherTypesTransaction);
    }
  }

  async processBalancingTransactions(userSource: User, userDest: User, balancingTransactions: TransactionSummary[], serverKnowledge: number) {

    for (const balancingTransaction of balancingTransactions) {
      await this.processSingleBalancingTransaction(userSource, userDest, balancingTransaction, serverKnowledge);
    }

  }

  // Balancing transactions are transactions between the users
  async processSingleBalancingTransaction(userSource: User, userDest: User, balancingTransaction: TransactionSummary, serverKnowledge: number) {
    const sharedTransction = await this.findTransactionInSharedBudget(balancingTransaction.id);

    // We got a shared transaction that is not supposed to be there. We delete it
    if (sharedTransction && compareServerKnowledge(serverKnowledge, sharedTransction)) {
      const updatedSharedTransaction = await this.updateBalancingTransaction(userSource, userDest, balancingTransaction, sharedTransction, serverKnowledge);
      await userDest.updateTransferTransaction(updatedSharedTransaction, sharedTransction.id);
    } else if(!sharedTransction) {
      const newSharedTransaction = await this.createBalancingTransaction(userSource, userDest, balancingTransaction);
      await userDest.addTransferTransaction(newSharedTransaction);
    }

  }

  private createTransactionObject(t: TransactionSummary, accountId: string, serverKnowledge: number): SaveTransaction {
    const payee_name = this.ynabClient.resolvePayeeName(t.payee_id || "");

    return {
      account_id: accountId,
      date: t.date,
      amount: t.amount, 
      // payee_id: t.payee_id, // Let's try to use the payee name instead
      payee_name,
      cleared: t.cleared,
      approved: t.approved,
      memo: this.createMemoForTransaction(t, serverKnowledge),
      flag_color: t.flag_color
    };
  }

  async checkAndEventuallyDeleteSharedExpense(otherTypesTransaction: TransactionSummary) {
    const sharedTransction = await this.findTransactionInSharedBudget(otherTypesTransaction.id);

    // We got a shared transaction that is not supposed to be there. We delete it
    if (sharedTransction) {
      const deletedSharedTransaction = await this.ynabClient.deleteTransaction(this.config.budgetId, sharedTransction.id);
      if (!deletedSharedTransaction?.data?.transaction) {
        throw new Error("Could not delete transaction")
      }
      console.log(`Deleted transaction ${sharedTransction}`, deletedSharedTransaction.data.transaction.id, "because it was not supposed to be there due to a category change");
    }

  }

  async findTransactionInSharedBudget(memoIncludes: string, bankAccountId?: string) {

    const sharedBudgetTransactions = await this.getTransactionsSummary();

    const targetSharedTransaction = sharedBudgetTransactions?.find((t) => {

      if (bankAccountId && t.account_id !== bankAccountId) {
        return false;
      }

      return t.memo?.includes(memoIncludes);
    });

    return targetSharedTransaction;
  }

  async checkAllocatedBudgetForAGivenMonth(month: string, allocatedAmount: number, bankAccountId: string, serverKnowledge: number) {

    const resultToProcess: {toCreate:SaveTransaction[], toUpdate: SaveTransaction[]} = {toCreate: [], toUpdate: []};

    console.log(`Checking monthly allocated budget for month ${month} with amount ${allocatedAmount} and bank account ${bankAccountId} in budget ${this.config.budgetId}`);

    const transaction = await this.findTransactionInSharedBudget(month, bankAccountId);

    const transactionData: SaveTransaction = {
      account_id: bankAccountId,
      date: month,
      amount: allocatedAmount,
      payee_name: "Monthly Allocated Budget",
      memo: `${month} @ `,
      flag_color: "purple" as TransactionFlagColor,
    };

    if (!transaction) {
      resultToProcess.toCreate.push(transactionData);
    } else if (compareServerKnowledge(serverKnowledge, transaction)) {
      resultToProcess.toUpdate.push(transactionData);
    }

    return resultToProcess;
  }

  async createBalancingTransaction(userSource: User, userDest: User, balancingTransaction: TransactionSummary) {

     // We need to apply the transfer to the shared budget. 
     const newTransaction = {
      account_id: userSource.config.sharedBudgetPrivateBankAccountId,
      date: balancingTransaction.date,
      amount: balancingTransaction.amount,
      payee_id: userDest.config.sharedBudgetPrivateAccountPayeeID,
      // payee_name: balancingTransaction.payee_name,
      cleared: balancingTransaction.cleared,
      approved: balancingTransaction.approved,
      memo: balancingTransaction.id + " " + "@ " + (balancingTransaction.memo || ""),
      flag_color: balancingTransaction.flag_color,
      import_id: balancingTransaction.import_id,
    };

    try {
      const newSharedTransaction = await this.ynabClient.createTransaction(this.config.budgetId, { transaction: newTransaction });

      if (!newSharedTransaction?.data.transaction) {
        throw new Error("Could not create transaction")
      }

      console.log("Transaction created in shared budget", newSharedTransaction?.data?.transaction?.id);

      return newSharedTransaction.data.transaction;
    } catch (e) {
      console.error("Error while updating transaction", e)
      throw e;
    }

  }

  async updateBalancingTransaction(userSource: User, userDest: User, balancingTransaction: TransactionSummary, sharedTransction: TransactionSummary, serverKnowledge: number): Promise<TransactionDetail> {
    const updatedTransaction = {
      account_id: userSource.config.sharedBudgetPrivateBankAccountId,
      date: balancingTransaction.date,
      amount: balancingTransaction.amount,
      payee_id: userDest.config.sharedBudgetPrivateAccountPayeeID,
      //payee_name: balancingTransaction.payee_name,
      cleared: balancingTransaction.cleared,
      approved: balancingTransaction.approved,
      memo: this.createMemoForTransaction(balancingTransaction, serverKnowledge),
      flag_color: balancingTransaction.flag_color,
      //import_id: balancingTransaction.import_id,
    };

    try {
      const updatedSharedTransaction = await this.ynabClient.updateTransaction(this.config.budgetId, sharedTransction.id, { transaction: updatedTransaction });

      if (!updatedSharedTransaction?.data.transaction) {
        throw new Error("Could not update transaction")
      }

      console.log(`Updated transaction ${sharedTransction}`, updatedSharedTransaction.data.transaction.id);

      return updatedSharedTransaction.data.transaction;
    } catch (e) {
      console.error("Error while updating transaction", e)
      throw e;
    }
  }

}



