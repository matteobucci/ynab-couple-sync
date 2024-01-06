

export interface AccountData {
    name: string;
    budgetId: string;
}


export interface UserData extends AccountData{
    sharedBudgetId: string;
    sharedBudgetPrivateBankAccountId: string;
    sharedBudgetPrivateAccountPayeeID: string;
    sharedCategoryName: string;
    sharedAccountGroupName: string;
    sharedCategoryBalancingName: string;
    balancingBankAccountId: string;
}