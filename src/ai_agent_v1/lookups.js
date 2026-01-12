const fs = require('fs-extra');
const path = require('path');

const LOOKUPS_FILE = path.join(__dirname, '../../data/lookups.json');

/**
 * Ensure file exists
 */
async function ensureFile() {
    if (!await fs.pathExists(LOOKUPS_FILE)) {
        await fs.writeJSON(LOOKUPS_FILE, { agencies: [], countries: [] }, { spaces: 2 });
    }
}

/**
 * Get all lookups
 */
async function getLookups() {
    await ensureFile();
    return await fs.readJSON(LOOKUPS_FILE);
}

/**
 * Save lookups
 */
async function saveLookups(data) {
    await fs.writeJSON(LOOKUPS_FILE, data, { spaces: 2 });
}

/**
 * Add Agency
 */
async function addAgency(name) {
    const data = await getLookups();
    if (!data.agencies.includes(name)) {
        data.agencies.push(name);
        await saveLookups(data);
    }
    return data.agencies;
}

/**
 * Remove Agency
 */
async function removeAgency(name) {
    const data = await getLookups();
    data.agencies = data.agencies.filter(a => a !== name);
    await saveLookups(data);
    return data.agencies;
}

/**
 * Add Country
 */
async function addCountry(name) {
    const data = await getLookups();
    if (!data.countries.find(c => c.name === name)) {
        data.countries.push({ name, cities: [] });
        await saveLookups(data);
    }
    return data.countries;
}

/**
 * Remove Country
 */
async function removeCountry(name) {
    const data = await getLookups();
    data.countries = data.countries.filter(c => c.name !== name);
    await saveLookups(data);
    return data.countries;
}

/**
 * Add City to Country
 */
async function addCity(countryName, cityName) {
    const data = await getLookups();
    const country = data.countries.find(c => c.name === countryName);
    if (country) {
        if (!country.cities.includes(cityName)) {
            country.cities.push(cityName);
            await saveLookups(data);
        }
    } else {
        throw new Error('Country not found');
    }
    return data.countries;
}

/**
 * Remove City from Country
 */
async function removeCity(countryName, cityName) {
    const data = await getLookups();
    const country = data.countries.find(c => c.name === countryName);
    if (country) {
        country.cities = country.cities.filter(c => c !== cityName);
        await saveLookups(data);
    }
    return data.countries;
}

module.exports = {
    getLookups,
    addAgency,
    removeAgency,
    addCountry,
    removeCountry,
    addCity,
    removeCity
};
