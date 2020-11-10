const GoogleSheetsHelper = require('../helpers/google-sheets');

const AnyOrderParser = require('../parser/any-order-parser')
const OrParser = require('../parser/or-parser')
const OptionalParser = require('../parser/optional-parser')

const TowerParser = require('../parser/tower-parser');
const TowerPathParser = require('../parser/tower-path-parser')
const TowerUpgradeParser = require('../parser/tower-upgrade-parser')
const HeroParser = require('../parser/hero-parser');

const VersionParser = require('../parser/version-parser');
const { getColumnIndexFromLetter } = require('../helpers/google-sheets');
const towers = require('../helpers/towers');

module.exports = {
    name: 'balance',
    dependencies: ['btd6index'],

    aliases: ['changes', 'balances'],
    execute,
};

async function execute(message, args) {
    if (args.length == 0 || (args.length == 1 && args[0] == 'help')) {
        return helpMessage(message);
    }

    entityParser = new OrParser(
        new TowerParser(),
        new TowerPathParser(),
        new TowerUpgradeParser()
    )

    const parsed = CommandParser.parse(
        args,
        new AnyOrderParser(
            entityParser,
            new OptionalParser(new VersionParser()),
            new OptionalParser(new VersionParser())
        )
    )

    if (parsed.hasErrors()) {
        return errorMessage(message, parsed.parsingErrors);
    }

    if (parsed.version) {
        return message.channel.send('Feature in progress')
    }

    await loadTowerBuffNerfsTableCells()
    colIndex = await locateSpecifiedTowerColumnIndex(parsed)
    balanceChanges = await parseBalanceChanges(parsed, colIndex)
    return await formatAndDisplayBalanceChanges(message, parsed, balanceChanges)
}

async function loadTowerBuffNerfsTableCells() {
    const sheet = towersSheet();
    const currentVersion = await parseCurrentVersion();

    // Load from C23 to {end_column}{C+version}
    bottomRightCellToBeLoaded = GoogleSheetsHelper.rowColToA1(HEADER_ROW + currentVersion - 1, sheet.columnCount)
    await sheet.loadCells(`${VERSION_COLUMN}${HEADER_ROW}:${bottomRightCellToBeLoaded}`);
}

async function locateSpecifiedTowerColumnIndex(parsed) {
    const sheet = towersSheet();

    // Parse {column}23 until tower alias is reached
    for (colIndex = GoogleSheetsHelper.getColumnIndexFromLetter(VERSION_COLUMN) + 1; colIndex < sheet.columnCount; colIndex += 2) {
        towerHeader = sheet.getCell(HEADER_ROW - 1, colIndex).value

        if(!towerHeader) throw `Something went wrong; ${parsed.tower} couldn't be found in the headers`
        
        canonicalHeader = Aliases.getCanonicalForm(towerHeader)
        if (parsed.tower && parsed.tower == canonicalHeader) {
            return colIndex
        } else if (parsed.tower_path && parsed.tower_path.split('#')[0] == canonicalHeader) {
            return colIndex
        } else if (parsed.tower_upgrade && towers.towerUpgradeToTower(parsed.tower_upgrade) == canonicalHeader) {
            return colIndex
        }
    }
}

VERSION_COLUMN = 'C'
HEADER_ROW = 23

function towersSheet() {
    return GoogleSheetsHelper.sheetByName(Btd6Index, 'Towers');
}

async function parseCurrentVersion() {
    const sheet = towersSheet();

    // Get version number from J3
    await sheet.loadCells(`J3`);
    const lastUpdatedAsOf = sheet.getCellByA1(`J3`).value
    const lastUpdatedAsOfTokens = lastUpdatedAsOf.split(' ')
    return new Number(
        lastUpdatedAsOfTokens[lastUpdatedAsOfTokens.length - 1]
    )
}

async function parseBalanceChanges(parsed, entryColIndex) {
    const sheet = towersSheet();
    const currentVersion = await parseCurrentVersion();

    let balances = {};
    // Iterate for currentVersion - 1 rows since there's no row for v1.0
    for (rowIndex = HEADER_ROW; rowIndex <= HEADER_ROW + currentVersion - 2; rowIndex++) {
        v = sheet.getCell(rowIndex, GoogleSheetsHelper.getColumnIndexFromLetter(VERSION_COLUMN)).formattedValue

        let buff = sheet.getCell(rowIndex, entryColIndex).note;
        buff = filterChangeNotes(buff, v, parsed)

        let nerf = sheet.getCell(rowIndex, entryColIndex + 1).note;
        nerf = filterChangeNotes(nerf, v, parsed)

        if (buff) {
            buff = buff.replace(/✔️/g, '✅');
            balances[v] = buff
        }
        if (nerf) {
            balances[v] = balances[v] ? balances[v] + "\n\n" : ""
            balances[v] += nerf
        }
    }

    return balances
}

function filterChangeNotes(note, v, parsed) {
    if (!note) return null;

    const version = new Number(v)
    if (parsed.versions) {
        if (parsed.versions.length == 2) {
            minV, maxV = parsed.versions.sort
            if (version < minV || version > maxV) return null;
        } else if (parsed.versions.length == 1) {
            if (version !== parsed.version) return null;
        }
    }

    notes = note.split("\n\n").filter(n => {
        // Filter here by tower specification
    }).join("\n\n")
}

async function formatAndDisplayBalanceChanges(message, parsed, balances) {
    formattedTower = Aliases.toIndexNormalForm(parsed.tower)

    let embed = new Discord.MessageEmbed()
        .setTitle(`Buffs and Nerfs for ${formattedTower}\n`)
        .setColor(colours['darkgreen'])
    
    for (const version in balances) {
        embed.addField(`v. ${version}`, balances[version] + "\n\u200b")
    }

    try {
        await message.channel.send(embed);
    } catch(e) {
        return message.channel.send(`Too many balance changes for ${formattedTower}; fix in progress`)
    }
}

function errorMessage(message, parsingErrors) {
    let errorEmbed = new Discord.MessageEmbed()
        .setTitle('ERROR')
        .addField(
            'Likely Cause(s)',
            parsingErrors.map((msg) => ` • ${msg}`).join('\n')
        )
        .addField('Type `q!2tc` for help', '\u200b')
        .setColor(colours['orange']);

    return message.channel.send(errorEmbed);
}

function helpMessage(message) {
    let helpEmbed = new Discord.MessageEmbed()
        .setTitle('`q!balance` HELP')
        .addField(
            '`q!balance <tower>`',
            'Get the patch notes for a given tower\n`q!balance heli`'
        )

    return message.channel.send(helpEmbed);
}
