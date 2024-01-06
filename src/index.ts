
import dotenv from "dotenv";
import { Actions } from "./actions";
import { YNABClient } from "./api/ynab";
import { AccountData, UserData } from "./model/user";
import { SharedAccount } from "./shared_account";
import { StateManager } from "./state_manager";
import { User } from "./user";
dotenv.config();

import yargs from 'yargs/yargs';

const argv = yargs(process.argv.slice(2)).options({
  forceRefreshCategory: { type: 'boolean', default: false, description: 'Force the refresh of the categories referring to shared budget'},
  token: { type: 'string', alias: 't', description: 'YNAB token' },
  specificYear: { type: 'number', alias: 'y', description: 'Specific year to sync'},
  specificMonth: { type: 'string', alias: 'm',  description: 'Specific month to sync in the format yyyy-MM-dd' },
  continue: { type: 'boolean', alias: 'c', default: false, description: 'Continue the execution of the script waiting for new payments after a timeout' },
  syncBudgeted: { type: 'boolean', alias: 'b', default: false, description:'Proceed with the update of the budgeted categories into the shared budget' },
  skipBalancingCheck: { type: 'boolean', alias: 's', default: false, description:'Skip the check of the balancing category' },
  user1: { type: 'string', alias: 'u1' },
  user2: { type: 'string', alias: 'u2' },
  verbose: { type: 'boolean', alias: 'v', default: false, description: 'Enable verbose logging' }
}).argv;

(async() => {

    const argvResult = await argv;

    const args = {
        forceRefreshCategory: argvResult.forceRefreshCategory,
        token: argvResult.token,
        specificMonth: argvResult.specificMonth,
        specificYear: argvResult.specificYear,
        continue: argvResult.continue,
        syncBudgeted: argvResult.syncBudgeted,
        user1: argvResult.user1,
        user2: argvResult.user2,
        skipBalancingCheck: argvResult.skipBalancingCheck,
        verbose: (argvResult.verbose || process.env.VERBOSE) === 'true' || false,
        syncAll: argvResult.syncAll
    }

    try {

        const startTime = Date.now();
        
        // We can set the token with env or use the one passed as argument
        const token = args.token || process.env.YNAB_TOKEN;
        const user1Name = args.user1 || process.env.USER1 || "user1";
        const user2Name = args.user2 || process.env.USER2 || "user2";
        const specificMonth = args.specificMonth || process.env.SPECIFIC_MONTH || null;
        const forceRefreshCategory = args.forceRefreshCategory || (process.env.FORCE_REFRESH_CATEGORY === 'true') || false;
        const continueExecution = args.continue || process.env.CONTINUE || false;
        const syncBudgeted = args.syncBudgeted || process.env.SYNC_BUDGETED === 'true' || false;
        const skipBalancingCheck = args.skipBalancingCheck || (process.env.SKIP_BALANCING_CHECK === 'true') || false;
        const specificYear = args.specificYear || process.env.SPECIFIC_YEAR || null;
    const syncAll = args.syncAll || process.env.SYNC_ALL || false;

        if(!token){
            throw new Error("Could not find YNAB token");
        }

        if(args.verbose){
            console.log("CMD Arguments", args);
        }

        if(args.verbose){
            console.log('Options applied:', JSON.stringify({
                user1Name,
                user2Name,
                forceRefreshCategory,
                specificMonth,
                specificYear,
                continueExecution,
                syncBudgeted,
                skipBalancingCheck
            }, null, 2));
        }
        
        
        const ynabClient = new YNABClient(token, new StateManager(`calls`, 'api'));
        const {sharedAccount, user1, user2} = await configureUsers(ynabClient, user1Name, user2Name, forceRefreshCategory);

        console.log(ynabClient.getNumberOfCalls().calls, "calls made to the API");
        const executor = new Actions([user1, user2], sharedAccount);

        await executor.syncAll();

        return;

        // Action selection
        switch(true){
            case syncAll:
                
                break;
            case syncBudgeted:
                await executor.checkMonthAllocatedBalance();
                break;
            case !!specificMonth:
                await executor.syncMonth(user1, specificMonth || '');
                await executor.syncMonth(user2, specificMonth || '');
                break;
            case !!specificYear:
                const syncPromises = Array.from({ length: 12 }, async (_, i) => {
                    const month = `${specificYear}-${(i + 1).toString().padStart(2, '0')}-01`;
                    await executor.syncMonth(user1, month);
                    await executor.syncMonth(user2, month);
                });
                await Promise.all(syncPromises);
                break;
            default:
                await executor.checkMonthStatus(user1);
                await executor.checkMonthStatus(user2);
                break;
        }
        
        const endTime = Date.now();
        console.log(`Execution completed in ${(endTime - startTime) / 1000} seconds.`);
        const apiCalls = ynabClient.getNumberOfCalls();
        console.log(apiCalls.calls, "calls made to the API");
        console.log(apiCalls.logs.join('\n'));

        await cleanUp(ynabClient, user1, user2);

    }catch (e) {
        if (e instanceof Error) {
            console.error(`Error: ${e}`);
        }
        else {
            console.error(`Error: ${JSON.stringify(e)}`);
        }
    }

 })();

 async function configureUsers(ynabClient: YNABClient, user1Name: string, user2Name: string, forceRefreshCategory: boolean){

    const user1Configuration = await new StateManager<UserData>(user1Name).getSavedState();
    const user2Configuration = await new StateManager<UserData>(user2Name).getSavedState();
    const sharedConfiguration = await new StateManager<AccountData>(`shared`).getSavedState();

    if(!user1Configuration || !user2Configuration || !sharedConfiguration){
        throw new Error("Could not find user configuration");
    }

    // TODO: Here we should do some validation on the configuration

    const sharedAccount = new SharedAccount(ynabClient, sharedConfiguration);
    const user1 = new User(ynabClient, user1Configuration, new StateManager('matteo-data', 'data'));
    const user2 = new User(ynabClient, user2Configuration, new StateManager('marghe-data', 'data'));

    // An user need to access to some of the API of the other user. This is a case that breaks the support of groups of multiple users
    user1.otherUser = user2;
    user2.otherUser = user1;

    // Catch the CTRL+C from the terminal
    process.on('SIGINT', async function() {
       await cleanUp(ynabClient, user1, user2);
    });

    // Init the users in parallel
    await Promise.all([
        sharedAccount.fetchBudget(), // In theory this fetch the budget now to avoid having to do it later
        user1.init(forceRefreshCategory),
        user2.init(forceRefreshCategory)
    ]);

    return {
        sharedAccount,
        user1,
        user2
    };
 }


 async function cleanUp(ynabClient: YNABClient, user1: User, user2: User){
    console.log("Caught interrupt signal");
    await ynabClient.saveState();
    await user1.saveState();
    await user2.saveState(); 
    process.exit();
 }
