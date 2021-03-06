const sql = require('./sql');
const sqlInit = require('./sql_init');
const eventService = require('./events');
const repository = require('./repository');
const protectedSessionService = require('./protected_session');
const utils = require('./utils');

let loaded = false;
let noteTitles = {};
let protectedNoteTitles = {};
let noteIds;
let childParentToBranchId = {};
const childToParent = {};
let archived = {};

// key is 'childNoteId-parentNoteId' as a replacement for branchId which we don't use here
let prefixes = {};

async function load() {
    noteTitles = await sql.getMap(`SELECT noteId, title FROM notes WHERE isDeleted = 0 AND isProtected = 0`);
    noteIds = Object.keys(noteTitles);

    prefixes = await sql.getMap(`SELECT noteId || '-' || parentNoteId, prefix FROM branches WHERE prefix IS NOT NULL AND prefix != ''`);

    const relations = await sql.getRows(`SELECT branchId, noteId, parentNoteId FROM branches WHERE isDeleted = 0`);

    for (const rel of relations) {
        childToParent[rel.noteId] = childToParent[rel.noteId] || [];
        childToParent[rel.noteId].push(rel.parentNoteId);
        childParentToBranchId[`${rel.noteId}-${rel.parentNoteId}`] = rel.branchId;
    }

    archived = await sql.getMap(`SELECT noteId, isInheritable FROM attributes WHERE isDeleted = 0 AND type = 'label' AND name = 'archived'`);

    loaded = true;
}

function findNotes(query) {
    if (!noteTitles || !query.length) {
        return [];
    }

    const tokens = query.toLowerCase().split(" ");
    const results = [];

    let noteIds = Object.keys(noteTitles);

    if (protectedSessionService.isProtectedSessionAvailable()) {
        noteIds = noteIds.concat(Object.keys(protectedNoteTitles));
    }

    for (const noteId of noteIds) {
        // autocomplete should be able to find notes by their noteIds as well (only leafs)
        if (noteId === query) {
            search(noteId, [], [], results);
            continue;
        }

        // for leaf note it doesn't matter if "archived" label inheritable or not
        if (noteId in archived) {
            continue;
        }

        const parents = childToParent[noteId];
        if (!parents) {
            continue;
        }

        for (const parentNoteId of parents) {
            // for parent note archived needs to be inheritable
            if (archived[parentNoteId] === 1) {
                continue;
            }

            const title = getNoteTitle(noteId, parentNoteId).toLowerCase();
            const foundTokens = [];

            for (const token of tokens) {
                if (title.includes(token)) {
                    foundTokens.push(token);
                }
            }

            if (foundTokens.length > 0) {
                const remainingTokens = tokens.filter(token => !foundTokens.includes(token));

                search(parentNoteId, remainingTokens, [noteId], results);
            }
        }
    }

    results.sort((a, b) => a.title < b.title ? -1 : 1);

    return results;
}

function search(noteId, tokens, path, results) {
    if (tokens.length === 0) {
        const retPath = getSomePath(noteId, path);

        if (retPath) {
            const noteTitle = getNoteTitleForPath(retPath);
            const thisNoteId = retPath[retPath.length - 1];
            const thisParentNoteId = retPath[retPath.length - 2];

            results.push({
                noteId: thisNoteId,
                branchId: childParentToBranchId[`${thisNoteId}-${thisParentNoteId}`],
                title: noteTitle,
                path: retPath.join('/')
            });
        }

        return;
    }

    const parents = childToParent[noteId];
    if (!parents || noteId === 'root') {
        return;
    }

    for (const parentNoteId of parents) {
        if (results.length >= 200) {
            return;
        }

        // archived must be inheritable
        if (archived[parentNoteId] === 1) {
            continue;
        }

        const title = getNoteTitle(noteId, parentNoteId).toLowerCase();
        const foundTokens = [];

        for (const token of tokens) {
            if (title.includes(token)) {
                foundTokens.push(token);
            }
        }

        if (foundTokens.length > 0) {
            const remainingTokens = tokens.filter(token => !foundTokens.includes(token));

            search(parentNoteId, remainingTokens, path.concat([noteId]), results);
        }
        else {
            search(parentNoteId, tokens, path.concat([noteId]), results);
        }
    }
}

function getNoteTitle(noteId, parentNoteId) {
    const prefix = prefixes[noteId + '-' + parentNoteId];

    let title = noteTitles[noteId];

    if (!title) {
        if (protectedSessionService.isProtectedSessionAvailable()) {
            title = protectedNoteTitles[noteId];
        }
        else {
            title = '[protected]';
        }
    }

    return (prefix ? (prefix + ' - ') : '') + title;
}

function getNoteTitleForPath(path) {
    const titles = [];

    if (path[0] === 'root') {
        if (path.length === 1) {
            return getNoteTitle('root');
        }
        else {
            path = path.slice(1);
        }
    }

    let parentNoteId = 'root';

    for (const noteId of path) {
        const title = getNoteTitle(noteId, parentNoteId);

        titles.push(title);
        parentNoteId = noteId;
    }

    return titles.join(' / ');
}

function getSomePath(noteId, path) {
    if (noteId === 'root') {
        path.push(noteId);
        path.reverse();

        return path;
    }

    const parents = childToParent[noteId];
    if (!parents || parents.length === 0) {
        return false;
    }

    for (const parentNoteId of parents) {
        // archived applies here only if inheritable
        if (archived[parentNoteId] === 1) {
            continue;
        }

        const retPath = getSomePath(parentNoteId, path.concat([noteId]));

        if (retPath) {
            return retPath;
        }
    }

    return false;
}

function getNotePath(noteId) {
    const retPath = getSomePath(noteId, []);

    if (retPath) {
        const noteTitle = getNoteTitleForPath(retPath);
        const parentNoteId = childToParent[noteId][0];

        return {
            noteId: noteId,
            branchId: childParentToBranchId[`${noteId}-${parentNoteId}`],
            title: noteTitle,
            path: retPath.join('/')
        };
    }
}

eventService.subscribe(eventService.ENTITY_CHANGED, async ({entityName, entity}) => {
    if (!loaded) {
        return;
    }

    if (entityName === 'notes') {
        const note = entity;

        if (note.isDeleted) {
            delete noteTitles[note.noteId];
            delete childToParent[note.noteId];
        }
        else {
            if (note.isProtected) {
                if (protectedSessionService.isProtectedSessionAvailable()) {
                    protectedNoteTitles[note.noteId] = protectedSessionService.decryptNoteTitle(note.noteId, note.title);
                }
            }
            else {
                noteTitles[note.noteId] = note.title;
            }
        }
    }
    else if (entityName === 'branches') {
        const branch = entity;

        // first we remove records for original placement (if they exist)
        childToParent[branch.noteId] = childToParent[branch.noteId] || [];
        childToParent[branch.noteId] = childToParent[branch.noteId].filter(noteId => noteId !== branch.origParentNoteId);

        delete prefixes[branch.noteId + '-' + branch.origParentNoteId];
        delete childParentToBranchId[branch.noteId + '-' + branch.origParentNoteId];

        if (!branch.isDeleted) {
            // ... and then we create new records
            if (branch.prefix) {
                prefixes[branch.noteId + '-' + branch.parentNoteId] = branch.prefix;
            }

            childToParent[branch.noteId].push(branch.parentNoteId);
            childParentToBranchId[branch.noteId + '-' + branch.parentNoteId] = branch.branchId;
        }
    }
    else if (entityName === 'attributes') {
        const attribute = entity;

        if (attribute.type === 'label' && attribute.name === 'archived') {
            // we're not using label object directly, since there might be other non-deleted archived label
            const hideLabel = await repository.getEntity(`SELECT * FROM attributes WHERE isDeleted = 0 AND type = 'label' 
                                 AND name = 'archived' AND noteId = ?`, [attribute.noteId]);

            if (hideLabel) {
                archived[attribute.noteId] = hideLabel.isInheritable ? 1 : 0;
            }
            else {
                delete archived[attribute.noteId];
            }
        }
    }
});

eventService.subscribe(eventService.ENTER_PROTECTED_SESSION, async () => {
    if (!loaded) {
        return;
    }

    protectedNoteTitles = await sql.getMap(`SELECT noteId, title FROM notes WHERE isDeleted = 0 AND isProtected = 1`);

    for (const noteId in protectedNoteTitles) {
        protectedNoteTitles[noteId] = protectedSessionService.decryptNoteTitle(noteId, protectedNoteTitles[noteId]);
    }
});

sqlInit.dbReady.then(() => utils.stopWatch("Autocomplete load", load));

module.exports = {
    findNotes,
    getNotePath,
    getNoteTitleForPath
};