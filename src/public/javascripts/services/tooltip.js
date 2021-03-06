import noteDetailService from "./note_detail.js";
import treeUtils from "./tree_utils.js";
import linkService from "./link.js";
import server from "./server.js";

function setupTooltip() {
    $(document).tooltip({
        items: "body a",
        content: function (callback) {
            const $link = $(this);

            if ($link.hasClass("no-tooltip-preview")) {
                return;
            }

            // this is to avoid showing tooltip from inside CKEditor link editor dialog
            if ($link.closest(".ck-link-actions").length) {
                return;
            }

            let notePath = linkService.getNotePathFromUrl($link.attr("href"));

            if (!notePath) {
                notePath = $link.attr("data-note-path");
            }

            if (notePath) {
                const noteId = treeUtils.getNoteIdFromNotePath(notePath);

                const notePromise = noteDetailService.loadNote(noteId);
                const attributePromise = server.get('notes/' + noteId + '/attributes');

                Promise.all([notePromise, attributePromise])
                    .then(([note, attributes]) => renderTooltip(callback, note, attributes));
            }
        },
        close: function (event, ui) {
            ui.tooltip.hover(function () {
                    $(this).stop(true).fadeTo(400, 1);
                },
                function () {
                    $(this).fadeOut('400', function () {
                        $(this).remove();
                    });
                });
        }
    });
}

async function renderTooltip(callback, note, attributes) {
    let content = '';
    const promoted = attributes.filter(attr =>
        (attr.type === 'label-definition' || attr.type === 'relation-definition')
        && !attr.name.startsWith("child:")
        && attr.value.isPromoted);

    if (promoted.length > 0) {
        const $table = $("<table>").addClass("promoted-attributes-in-tooltip");

        for (const definitionAttr of promoted) {
            const definitionType = definitionAttr.type;
            const valueType = definitionType.substr(0, definitionType.length - 11);

            let valueAttrs = attributes.filter(el => el.name === definitionAttr.name && el.type === valueType);

            for (const valueAttr of valueAttrs) {
                if (!valueAttr.value) {
                    continue;
                }

                let $value = "";

                if (valueType === 'label') {
                    $value = $("<td>").text(valueAttr.value);
                }
                else if (valueType === 'relation' && valueAttr.value) {
                    $value = $("<td>").append(await linkService.createNoteLink(valueAttr.value));
                }

                const $row = $("<tr>")
                    .append($("<th>").text(definitionAttr.name))
                    .append($value);

                $table.append($row);
            }
        }

        content += $table.prop('outerHTML');
    }

    if (note.type === 'text') {
        content += note.content;
    }
    else if (note.type === 'code') {
        content += $("<pre>").text(note.content).prop('outerHTML');
    }
    // other types of notes don't have tooltip preview

    if (!$(content).text().trim()) {
        return;
    }

    callback(content);
}

export default {
    setupTooltip
}