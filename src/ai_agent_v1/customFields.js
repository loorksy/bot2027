/**
 * Custom Fields Module
 * Allows admin to define custom fields with optional dropdown options
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const FIELDS_FILE = path.join(DATA_DIR, 'custom_fields.json');

/**
 * Ensure data file exists
 */
async function ensureFile() {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(FIELDS_FILE)) {
        await fs.writeJSON(FIELDS_FILE, [], { spaces: 2 });
    }
}

/**
 * Get all custom fields
 * @returns {Array} Array of custom field definitions
 */
async function getAllFields() {
    await ensureFile();
    try {
        return await fs.readJSON(FIELDS_FILE);
    } catch {
        return [];
    }
}

/**
 * Get a field by ID
 */
async function getFieldById(fieldId) {
    const fields = await getAllFields();
    return fields.find(f => f.id === fieldId) || null;
}

/**
 * Add a new custom field
 * @param {Object} fieldData - { name, type, options?, required? }
 * Options can be: ['option1', 'option2'] or [{ value: 'option1', subField: { type: 'text', label: 'label' } }]
 */
async function addField(fieldData) {
    await ensureFile();

    const { name, type = 'text', options = [], required = false } = fieldData;

    if (!name || !name.trim()) {
        throw new Error('Field name is required');
    }

    const fields = await getAllFields();

    // Check duplicate name
    const nameLower = name.trim().toLowerCase();
    if (fields.some(f => f.name.toLowerCase() === nameLower)) {
        throw new Error('Field with this name already exists');
    }

    // Normalize options - can be simple strings or objects with sub-fields
    let normalizedOptions = [];
    if (type === 'dropdown' && options.length > 0) {
        normalizedOptions = options.map(opt => {
            if (typeof opt === 'string') {
                return { value: opt.trim(), subField: null };
            } else if (typeof opt === 'object' && opt.value) {
                return {
                    value: opt.value.trim(),
                    subField: opt.subField || null
                };
            }
            return null;
        }).filter(o => o && o.value);
    }

    const newField = {
        id: uuidv4(),
        name: name.trim(),
        key: name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\u0600-\u06FF]/g, ''),
        type: ['text', 'dropdown', 'number', 'date'].includes(type) ? type : 'text',
        options: normalizedOptions,
        required: !!required,
        createdAt: new Date().toISOString()
    };

    fields.push(newField);
    await fs.writeJSON(FIELDS_FILE, fields, { spaces: 2 });

    return newField;
}

/**
 * Update a field
 */
async function updateField(fieldId, updates) {
    await ensureFile();

    const fields = await getAllFields();
    const index = fields.findIndex(f => f.id === fieldId);

    if (index === -1) {
        throw new Error('Field not found');
    }

    // Cannot change id, key, createdAt
    delete updates.id;
    delete updates.key;
    delete updates.createdAt;

    // If updating options and not dropdown, ignore
    if (updates.options && fields[index].type !== 'dropdown') {
        delete updates.options;
    }

    fields[index] = {
        ...fields[index],
        ...updates,
        updatedAt: new Date().toISOString()
    };

    await fs.writeJSON(FIELDS_FILE, fields, { spaces: 2 });

    return fields[index];
}

/**
 * Add option to dropdown field (with optional sub-field)
 * @param {string} fieldId
 * @param {string|Object} option - 'value' or { value: 'value', subField: { type, label } }
 */
async function addOption(fieldId, option) {
    const fields = await getAllFields();
    const field = fields.find(f => f.id === fieldId);

    if (!field) {
        throw new Error('Field not found');
    }

    if (field.type !== 'dropdown') {
        throw new Error('Cannot add options to non-dropdown field');
    }

    // Normalize option
    let optionObj;
    if (typeof option === 'string') {
        optionObj = { value: option.trim(), subField: null };
    } else if (typeof option === 'object' && option.value) {
        optionObj = {
            value: option.value.trim(),
            subField: option.subField || null
        };
    } else {
        throw new Error('Invalid option format');
    }

    if (!optionObj.value) {
        throw new Error('Option value cannot be empty');
    }

    // Check duplicate
    if (field.options.some(o => (o.value || o) === optionObj.value)) {
        throw new Error('Option already exists');
    }

    field.options.push(optionObj);
    field.updatedAt = new Date().toISOString();

    await fs.writeJSON(FIELDS_FILE, fields, { spaces: 2 });

    return field;
}

/**
 * Remove option from dropdown field
 */
async function removeOption(fieldId, option) {
    const fields = await getAllFields();
    const field = fields.find(f => f.id === fieldId);

    if (!field) {
        throw new Error('Field not found');
    }

    const optIndex = field.options.indexOf(option);
    if (optIndex === -1) {
        throw new Error('Option not found');
    }

    field.options.splice(optIndex, 1);
    field.updatedAt = new Date().toISOString();

    await fs.writeJSON(FIELDS_FILE, fields, { spaces: 2 });

    return field;
}

/**
 * Delete a field
 */
async function deleteField(fieldId) {
    await ensureFile();

    const fields = await getAllFields();
    const index = fields.findIndex(f => f.id === fieldId);

    if (index === -1) {
        throw new Error('Field not found');
    }

    fields.splice(index, 1);
    await fs.writeJSON(FIELDS_FILE, fields, { spaces: 2 });
}

/**
 * Reorder fields
 */
async function reorderFields(fieldIds) {
    const fields = await getAllFields();
    const reordered = [];

    for (const id of fieldIds) {
        const field = fields.find(f => f.id === id);
        if (field) {
            reordered.push(field);
        }
    }

    // Add any fields that weren't in the order list
    for (const field of fields) {
        if (!reordered.find(f => f.id === field.id)) {
            reordered.push(field);
        }
    }

    await fs.writeJSON(FIELDS_FILE, reordered, { spaces: 2 });

    return reordered;
}

module.exports = {
    getAllFields,
    getFieldById,
    addField,
    updateField,
    addOption,
    removeOption,
    deleteField,
    reorderFields
};
