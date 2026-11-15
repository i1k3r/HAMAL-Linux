#!/usr/bin/env node
// Validates the frontend translation data so a malformed or incomplete locale can't ship unnoticed.
//
//   node scripts/check-i18n.mjs
//
// Checks: both translation files parse, i18n-lighttable.js merges into TRANSLATIONS, every locale
// has every Light Table key that English has, no value is empty, and every value uses the same
// {placeholders} as its English source. Exits non-zero with a list of problems.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "src");
const files = ["i18n.js", "i18n-lighttable.js"];
const problems = [];

const context = vm.createContext({
    document: {
        documentElement: { setAttribute() {} },
        querySelectorAll: () => [],
    },
});

for (const file of files) {
    try {
        vm.runInContext(readFileSync(join(root, file), "utf8"), context, { filename: file });
    } catch (err) {
        console.error(`${file}: ${err.message}`);
        process.exit(1);
    }
}

const T = vm.runInContext("typeof TRANSLATIONS === 'object' ? TRANSLATIONS : null", context);
const LT = vm.runInContext("typeof LIGHT_TABLE_TRANSLATIONS === 'object' ? LIGHT_TABLE_TRANSLATIONS : null", context);
if (!T || !LT) {
    console.error("TRANSLATIONS or LIGHT_TABLE_TRANSLATIONS is not defined");
    process.exit(1);
}

const EXPECTED_LOCALES = ["en", "tr", "zh-CN", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur", "id", "de", "ja", "mr", "te", "nl", "it", "ko", "pl"];
const placeholders = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");

for (const locale of EXPECTED_LOCALES) {
    if (!T[locale]) problems.push(`${locale}: missing from TRANSLATIONS`);
    if (!LT[locale]) problems.push(`${locale}: missing from LIGHT_TABLE_TRANSLATIONS`);
}
for (const locale of Object.keys(T)) {
    if (!EXPECTED_LOCALES.includes(locale)) problems.push(`${locale}: unexpected locale`);
}

// Every value in every locale must be a non-empty string with the English placeholders.
for (const [locale, dict] of Object.entries(T)) {
    for (const [key, value] of Object.entries(dict)) {
        if (typeof value !== "string" || value.trim() === "") {
            problems.push(`${locale}: ${key} is empty`);
            continue;
        }
        const en = T.en[key];
        if (en !== undefined && placeholders(en) !== placeholders(value)) {
            problems.push(`${locale}: ${key} uses {${placeholders(value)}} but English uses {${placeholders(en)}}`);
        }
    }
}

// The Light Table UI is new in every language, so every locale must cover all of it.
const ltKeys = Object.keys(LT.en);
for (const locale of EXPECTED_LOCALES) {
    const dict = LT[locale] || {};
    for (const key of ltKeys) {
        if (!(key in dict)) problems.push(`${locale}: missing ${key}`);
    }
    for (const key of Object.keys(dict)) {
        if (!(key in LT.en)) problems.push(`${locale}: ${key} is not an English key`);
        if (T[locale] && T[locale][key] !== dict[key]) problems.push(`${locale}: ${key} was not merged into TRANSLATIONS`);
    }
}

// Every data-i18n key used in index.html must exist in English.
const html = readFileSync(join(root, "index.html"), "utf8");
for (const m of html.matchAll(/data-i18n(?:-html|-placeholder)?="([^"]+)"/g)) {
    if (!(m[1] in T.en)) problems.push(`index.html: unknown key ${m[1]}`);
}
// Every tr("...") key used in main.js must exist in English.
const js = readFileSync(join(root, "main.js"), "utf8");
for (const m of js.matchAll(/\btr\(\s*"([^"]+)"/g)) {
    if (!(m[1] in T.en)) problems.push(`main.js: unknown key ${m[1]}`);
}

if (problems.length) {
    console.error(`Translation check failed (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
}
console.log(`Translations OK: ${EXPECTED_LOCALES.length} locales, ${Object.keys(T.en).length} keys, ${ltKeys.length} Light Table keys.`);
