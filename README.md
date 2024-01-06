# Couple Shared Account for YNAB


## Regarding YNAB metodology
This project comes from my need of having to share expenses with my girfriend while keeping our own budget separates and without owning a shared bank account.

This metodology allows to:
- Have a personal budget with a category to money that will be spent as a couple
- Have a shared budget to handle anything shared indipendently from the personal budgets
- It's possible to contribute evenly or one of the two budgets can contribute more

Future improvements:
- Such system could manage groups as well, with only a few improvements. I guess the use case are more limited, but still it can help a lot

How all of this works?
The concept is that each individual has two categories that rapresent their contribute to the household budget.
One category contains all the expenses that will be shared, the other rapresent the transfer between individuals to even out the expeses.

1 - Set a monthly budget
Each individual set an amount budgeted on the shared category. This will create an inflow on the shared budget.
The total amount at disposal is equal to the sum of budgeted amounts in the shared categories.
This allow to budget shared expenses as well.

2 - Whenever something is shared, chose the Shared Expenses in your personal budget
This allows the payment to be added in the shared account as well.

3 - Just category the payment on the shared account

That's it!

How can I see how much I contributed on the shared expenses?
The available amount on your shared category and the amount of your account on the joint budget is what you spent so far.
If one person has 100 available and the other 200, but both budgeted 300, it means that the second person spent 100 less than the first.
A payment of 50 between the parts will make the situation equal

4 - If you pay your debts, choose Shared Expense Balancing category
This will create two transactions, one in the shared account and the other in the other person budget.

Note: Please don't touch payments with an @ in the memo. This means that a payment has been generated and you can just edit/delete the source payment.

Limitation:
YNAB can just do 200 api calls per hour, so in case of big sync we can reach the maximum amount of requests




## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Installation

```
npm install
```

```
npm start
```

## Usage

Instructions on how to use the project and any relevant examples.

## Contributing

Any type of feedback is welcome. Any contribution can be done with a PR and I will be happy to review it.

## License

This project is licensed under the MIT License. This allows anyone to use, modify, and distribute the software, including for commercial purposes, as long as they include the original license and copyright notice.

## Contact

You can find me profile on Github and there you can find contact information.

# Deploy

On cloud run
```
docker build . --tag europe-west1-docker.pkg.dev/matteo-bucci-personal/ynab-couple-sync/couple-sync-runner:1.0.0

```
# npm run start --token=XXXXX --specific-month=2023-12-01 --verbose


## Todo

v1:
- Optimize queries to avoid rate limiting (Done)
- Understand if there is any type of pagination of API transactions (Nope, there is none, but there are transactions summary and real ones)
- Allow to set the months to sync as parameter (Done)
- Cache requests to the API (this has been done via service layer, the api counts the number of them used)
- Use saved state (Doing it!)
- Add .ENV (Done!)
- Complete batch requests (Done)
- Make sure that the sync of a given month is absolutely optimized. Payyes are not working and fetchTransactions is repeated when the requests are subsequent. It should not, even I said I have no server knowledge.
- Make sure that the check of other types of expense is optimized
- Make sure that the creation of users is optimized



v2:
- Better separation of tasks
- Terminal parameters to run the server
- Docker & Deployment
- Better user definition
Maybe another script? Something like npm run init-users that from a config file save their ids.



## Changelog
v1.0.0
This is not a milestone version or anything similar. I just need to start using version control on this. 

