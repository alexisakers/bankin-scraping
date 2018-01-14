/*
 * bankin-scraping
 * 
 * Copyright (c) 2018 Alexis Aubry. Licensed under the terms of the MIT Licence.
 */

const { ThenableWebDriver, By } = require("selenium-webdriver");

/**
 * Cette classe scrappe le contenu d'un driver Chrome pour en extraire les transactions.  
 * 
 * Note: Une fois le driver assigné à un scrappeur, vous ne pourrez plus rien assumer à son propos
 * (ex: URL, contenu HTML, ...) puisque le scrappeur modifiera un grand nombre de données.
 * 
 * Il est recommandé de ne plus utilisé le driver après avoir commencé à scrapper la page.
 */

class PageScraper {

    /**
     * Créé un nouveau scrappeur de page en lui assignant un driver Chrome.
     * 
     * @param {ThenableWebDriver} driver Le driver Chrome contenant la page à analyser.
     */

    constructor(driver) {
        this.driver = driver;
    }

    /**
     * Commence le scrapping et extrait les transactions de la page web.
     * 
     * Cette méthode fournit les résultats du scraping sous la forme d'un Array d'objets.
     * 
     * Utilisez `await` pour attendre les résultats de cette fonction asynchrone.
     */

    async parseTransactionData() {

        const driver = this.driver;

        // La page peut afficher aléatoirement une alerte au lancement.
        // Il faut cacher cette alerte avant de commencer à traiter les éléments affichés.

        await dismissAlertIfNeeded(driver);

        return (async () => {

            // La position du curseur dans la liste. On commence à 0 (la première transaction).
            var currentIndex = 0

            // La liste de toutes les transactions.
            var transactions = [];

            // Cette boucle va récupérer toutes les transactions, en avançant dans la liste
            // des transactions jusqu'à ce qu'elle soit vide.

            while(true) {

                // On récupère toutes les transactions affichées sur la page.
                const newTransactions = await parseWebElements(driver);

                if (newTransactions.length == 0) {
                    // Si il n'y a pas de nouvelles transactions (le tableau est vide)
                    // alors le scraping est terminé, on peut quitter la boucle.
                    break;
                }

                // On ajoute les nouvelles transactions à la liste des transactions déjà récupérées.
                transactions = transactions.concat(newTransactions);

                // On bouge le curseur de la liste après le numéro de la dernière transaction récupérée
                // (par ex: si on démarre à la transaction 50 et que 50 transactions ont été trouvées, 
                // le prochain cycle commencera à la transaction 100). 
                currentIndex += newTransactions.length;

                // On charge la suite de la liste dans le driver Chrome.
                await driver.executeScript("start = " + currentIndex.toString() + ";");

            }

            return transactions;

        })();
        
    }

}

module.exports = PageScraper

/*=== Parsers ===*/

/**
 * Démarre le traitement des éléments sur la page.
 * 
 * Avant de scrapper les transactions, cette méthode prépare la page:
 * 
 * - Elle désactive le mode échec et le mode lent
 * - Elle désactive les iFrame
 * - Elle recharge le tableau principal, pour afficher les données pour la partie de la liste actuelle
 * 
 * Toutes les transactions ont été traitées une fois que le tableau affiché est vide.
 * 
 * @param {ThenableWebDriver} driver Le driver où la page à scrapper est chargée.
 * @return {Object[]} Les transactions trouvées sur la page.
 */

async function parseWebElements(driver) {

    // Les transactions qui ont été trouvées sur cette page.
    var transactions = [];

    // Désactiver le regénération automatique du tableau.
    await driver.executeScript("generate = function() {};")

    // Désactiver le mode échec, le mode lent et les iFrame
    await driver.executeScript("failmode = false; slowmode = false; hasiframe = false;");

    // Regénérer la table
    await driver.executeScript("doGenerate();");

    // Obtenir le contenu de chaque ligne du table (sous forme d'array)
    const tableRows = await driver.executeScript(extractMainTableRows);

    // Scrapper le contenu de la table et le retourner à la fonction principale.
    return parseTable(tableRows);

}

/**
 * Extraits les transactions d'un tableau HTML.
 * 
 * @param {String[][]} rows Les lignes tableau où se trouvent les transactions.
 */

async function parseTable(rows) {

    // > Statut du tableau

    if (rows.length == 0) {
        // Si le tableau ne contient pas de lignes, alors toutes les transactions ont été
        // scrappées. On retourne un array vide pour que la fonction principale comprenne
        // que le scrapping est terminé.
        return [];
    }

    // > Extraction des transactions

    var transactions = [];
    
    // Pour chaque rangée, extraire une transaction.
    for (var i = 0; i < rows.length; i++) {
        const transaction = await parseTransactionRow(rows[i]);
        transactions.push(transaction);
    }

    // On retourne toutes les transactions à la fonction principale.
    return transactions;

}

/*=== Helpers ===*/

/**
 * Si une alerte est présente sur la page au chargement, cette méthode la cache.
 * 
 * @param {ThenableWebDriver} driver Le driver contenant la page où une alerte est affichée.
 */

async function dismissAlertIfNeeded(driver) {

    try {
        // Une fois l'alerte acceptée, la page est prête.
        await driver.switchTo().alert().accept();
    } catch(e) {
        // Si il n'y a pas d'alerte, la page est déjà prête.
    }

    return driver;

}

/**
 * Extrait les informations de transaction d'une rangée d'un tableau.
 * 
 * @param {String[]} data Un array contenant chaque colonne de la transaction.
 * 
 * La rangée doit contenir trois colonnes. La transaction est retournée au format suivant:
 * 
 * {
 *      "Account": string,
 *      "Transaction": string,
 *      "Amount": number,
 *      "Currency": string
 * }
 * 
 * La devise de la transaction est représentée par son symbole (ex: si "Currency": "€" alors la
 * devise est en euros). 
 * 
 * @return {object} L'objet contenant les infos de la transaction.
 */

async function parseTransactionRow(data) {

    // Obtenir le montant et la devise

    const amountCellText = data[2];

    const currency = amountCellText.charAt(amountCellText.length - 1);
    const amountText = amountCellText.slice(0, amountCellText.length - 1);
    const amount = parseInt(amountText);

    // Créer l'objet transaction au format JSON

    return {
        "Account": data[0],
        "Transaction": data[1],
        "Amount": amount,
        "Currency": currency
    };

}

/**
 * Extrait le texte du tableau principal et retourne un Array.
 *
 * Ce script JS est exécuté dans Chrome directement (plus de rapidité).
 * 
 * La première ligne du tableau (l'en-tête) est ignorée. Si ce script retourne un
 * Array vide alors le tableau est vide et le scraping est terminé.
 * 
 * @return {String[][]} Un array contenant le contenu de chaque ligne du tableau.
 * 
 * Exemple:
 * 
 * [
 *   ["Savings", "Transaction 2", "250€"],
 *   ["Checking", "Transaction 3", "800€"]
 * ] 
 */

const extractMainTableRows = `
var table = document.getElementsByTagName("table")[0];

var rows = [];
var rowElements = table.getElementsByTagName("tr");

for(var i=1; i< rowElements.length; i++) {

    var cells = rowElements[i].children;
    var cellTexts = [];

    for(var j=0; j < cells.length; j++) {
       cellTexts.push(cells[j].innerText);
    }
        
    rows.push(cellTexts);
      
}
      
return rows;
`;