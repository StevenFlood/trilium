import linkService from '../services/link.js';
import utils from '../services/utils.js';
import server from '../services/server.js';

const $dialog = $("#recent-changes-dialog");

async function showDialog() {
    glob.activeDialog = $dialog;

    $dialog.dialog({
        modal: true,
        width: 800,
        height: 700
    });

    const result = await server.get('recent-changes/');

    $dialog.empty();

    if (result.length === 0) {
        $dialog.append("No changes yet ...");
    }

    const groupedByDate = groupByDate(result);

    for (const [dateDay, dayChanges] of groupedByDate) {
        const changesListEl = $('<ul>');

        const dayEl = $('<div>').append($('<b>').html(utils.formatDate(dateDay))).append(changesListEl);

        for (const change of dayChanges) {
            const formattedTime = utils.formatTime(utils.parseDate(change.dateModifiedTo));

            const revLink = $("<a>", {
                href: 'javascript:',
                text: 'rev'
            }).attr('data-action', 'note-revision')
                .attr('data-note-path', change.noteId)
                .attr('data-note-revision-id', change.noteRevisionId);

            let noteLink;

            if (change.current_isDeleted) {
                noteLink = change.current_title;
            }
            else {
                noteLink = await linkService.createNoteLink(change.noteId, change.title);
            }

            changesListEl.append($('<li>')
                .append(formattedTime + ' - ')
                .append(noteLink)
                .append(' (').append(revLink).append(')'));
        }

        $dialog.append(dayEl);
    }
}

function groupByDate(result) {
    const groupedByDate = new Map();
    const dayCache = {};

    for (const row of result) {
        let dateDay = utils.parseDate(row.dateModifiedTo);
        dateDay.setHours(0);
        dateDay.setMinutes(0);
        dateDay.setSeconds(0);
        dateDay.setMilliseconds(0);

        // this stupidity is to make sure that we always use the same day object because Map uses only
        // reference equality
        if (dayCache[dateDay]) {
            dateDay = dayCache[dateDay];
        }
        else {
            dayCache[dateDay] = dateDay;
        }

        if (!groupedByDate.has(dateDay)) {
            groupedByDate.set(dateDay, []);
        }

        groupedByDate.get(dateDay).push(row);
    }
    return groupedByDate;
}

export default {
    showDialog
};