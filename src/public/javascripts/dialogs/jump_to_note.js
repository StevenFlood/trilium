import treeService from '../services/tree.js';
import searchNotesService from '../services/search_notes.js';
import noteautocompleteService from '../services/note_autocomplete.js';
import linkService from "../services/link.js";

const $dialog = $("#jump-to-note-dialog");
const $autoComplete = $("#jump-to-note-autocomplete");
const $showInFullTextButton = $("#show-in-full-text-button");
const $showRecentNotesButton = $dialog.find(".show-recent-notes-button");

async function showDialog() {
    glob.activeDialog = $dialog;

    $autoComplete.val('');

    $dialog.dialog({
        modal: true,
        width: 800,
        position: { my: "center top+100", at: "top", of: window }
    });

    await $autoComplete.autocomplete({
        source: noteautocompleteService.autocompleteSource,
        focus: event => event.preventDefault(),
        minLength: 0,
        autoFocus: true,
        select: function (event, ui) {
            if (ui.item.value === 'No results') {
                return false;
            }

            const notePath = linkService.getNotePathFromLabel(ui.item.value);

            treeService.activateNote(notePath);

            $dialog.dialog('close');
        }
    });

    showRecentNotes();
}

function showInFullText(e) {
    // stop from propagating upwards (dangerous especially with ctrl+enter executable javascript notes)
    e.preventDefault();
    e.stopPropagation();

    const searchText = $autoComplete.val();

    searchNotesService.resetSearch();
    searchNotesService.showSearch();
    searchNotesService.doSearch(searchText);

    $dialog.dialog('close');
}

function showRecentNotes() {
    $autoComplete.autocomplete("search", "");
}

$showInFullTextButton.click(showInFullText);

$showRecentNotesButton.click(showRecentNotes);

$dialog.bind('keydown', 'ctrl+return', showInFullText);

export default {
    showDialog
};