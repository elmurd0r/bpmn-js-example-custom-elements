import {
    isArray,
    isFunction,
    forEach
} from 'min-dash';

import {
    domify,
    query as domQuery,
    attr as domAttr,
    clear as domClear,
    classes as domClasses,
    matches as domMatches,
    delegate as domDelegate,
    event as domEvent
} from 'min-dom';
import {getEncodedSvg} from "../CustomUtil";


var TOGGLE_SELECTOR = '.djs-palette-toggle',
    ENTRY_SELECTOR = '.entry',
    ELEMENT_SELECTOR = TOGGLE_SELECTOR + ', ' + ENTRY_SELECTOR;

var PALETTE_OPEN_CLS = 'open',
    PALETTE_TWO_COLUMN_CLS = 'two-column';

var DEFAULT_PRIORITY = 1000;


/**
 * A palette containing modeling elements.
 */
export default function CustomRealPalette(eventBus, canvas) {

    this._eventBus = eventBus;
    this._canvas = canvas;

    var self = this;

    eventBus.on('tool-manager.update', function(event) {
        var tool = event.tool;

        self.updateToolHighlight(tool);
    });

    eventBus.on('i18n.changed', function() {
        self._update();
    });

    eventBus.on('diagram.init', function() {

        self._diagramInitialized = true;

        self._rebuild();
    });
}

CustomRealPalette.$inject = [ 'eventBus', 'canvas' ];


/**
 * Register a provider with the palette
 *
 * @param  {number} [priority=1000]
 * @param  {PaletteProvider} provider
 *
 * @example
 * const paletteProvider = {
 *   getPaletteEntries: function() {
 *     return function(entries) {
 *       return {
 *         ...entries,
 *         'entry-1': {
 *           label: 'My Entry',
 *           action: function() { alert("I have been clicked!"); }
 *         }
 *       };
 *     }
 *   }
 * };
 *
 * palette.registerProvider(800, paletteProvider);
 */
CustomRealPalette.prototype.registerProvider = function(priority, provider) {
    if (!provider) {
        provider = priority;
        priority = DEFAULT_PRIORITY;
    }

    this._eventBus.on('palette.getProviders', priority, function(event) {
        event.providers.push(provider);
    });

    this._rebuild();
};


/**
 * Returns the palette entries
 *
 * @return {Object<string, PaletteEntryDescriptor>} map of entries
 */
CustomRealPalette.prototype.getEntries = function() {
    var providers = this._getProviders();

    return providers.reduce(addPaletteEntries, {});
};

CustomRealPalette.prototype._rebuild = function() {

    if (!this._diagramInitialized) {
        return;
    }

    var providers = this._getProviders();

    if (!providers.length) {
        return;
    }

    if (!this._container) {
        this._init();
    }

    this._update();
};

/**
 * Initialize
 */
CustomRealPalette.prototype._init = function() {

    var self = this;

    var eventBus = this._eventBus;

    var parentContainer = this._getParentContainer();

    var container = this._container = domify(CustomRealPalette.HTML_MARKUP);

    parentContainer.appendChild(container);

    domDelegate.bind(container, ELEMENT_SELECTOR, 'click', function(event) {

        var target = event.delegateTarget;

        if (domMatches(target, TOGGLE_SELECTOR)) {
            return self.toggle();
        }

        self.trigger('click', event);
    });

    // prevent drag propagation
    domEvent.bind(container, 'mousedown', function(event) {
        event.stopPropagation();
    });

    // prevent drag propagation
    domDelegate.bind(container, ENTRY_SELECTOR, 'dragstart', function(event) {
        self.trigger('dragstart', event);
    });

    eventBus.on('canvas.resized', this._layoutChanged, this);

    eventBus.fire('palette.create', {
        container: container
    });
};

CustomRealPalette.prototype._getProviders = function(id) {

    var event = this._eventBus.createEvent({
        type: 'palette.getProviders',
        providers: []
    });

    this._eventBus.fire(event);

    return event.providers;
};

/**
 * Update palette state.
 *
 * @param  {Object} [state] { open, twoColumn }
 */
CustomRealPalette.prototype._toggleState = function(state) {

    state = state || {};

    var parent = this._getParentContainer(),
        container = this._container;

    var eventBus = this._eventBus;

    var twoColumn;

    var cls = domClasses(container);

    if ('twoColumn' in state) {
        twoColumn = state.twoColumn;
    } else {
        twoColumn = this._needsCollapse(parent.clientHeight, this._entries || {});
    }

    // always update two column
    cls.toggle(PALETTE_TWO_COLUMN_CLS, twoColumn);

    if ('open' in state) {
        cls.toggle(PALETTE_OPEN_CLS, state.open);
    }

    eventBus.fire('palette.changed', {
        twoColumn: twoColumn,
        open: this.isOpen()
    });
};

CustomRealPalette.prototype._update = function() {

    var entriesContainer = domQuery('.djs-palette-entries', this._container),
        entries = this._entries = this.getEntries();

    domClear(entriesContainer);

    forEach(entries, function(entry, id) {

        var grouping = entry.group || 'default';

        var container = domQuery('[data-group=' + grouping + ']', entriesContainer);
        if (!container) {
            container = domify('<div class="group" data-group="' + grouping + '"></div>');
            entriesContainer.appendChild(container);
        }


        var html;
        if(entry.iot) {
            html =  ('<div class="entry" draggable="true"><img style="width: 25px" src="'+ getEncodedSvg(entry.iot, null) +'"></div>');
        } else {
            html = entry.html || (
                entry.separator ?
                    '<hr class="separator" />' :
                    '<div class="entry" draggable="true"></div>');
        }


        var control = domify(html);
        container.appendChild(control);

        if (!entry.separator) {
            domAttr(control, 'data-action', id);

            if (entry.title) {
                domAttr(control, 'title', entry.title);
            }

            if (entry.className) {
                addClasses(control, entry.className);
            }

            if (entry.imageUrl) {
                control.appendChild(domify('<img src="' + entry.imageUrl + '">'));
            }
        }
    });

    // open after update
    this.open();
};


/**
 * Trigger an action available on the palette
 *
 * @param  {string} action
 * @param  {Event} event
 */
CustomRealPalette.prototype.trigger = function(action, event, autoActivate) {
    var entries = this._entries,
        entry,
        handler,
        originalEvent,
        button = event.delegateTarget || event.target;

    if (!button) {
        return event.preventDefault();
    }

    entry = entries[domAttr(button, 'data-action')];

    // when user clicks on the palette and not on an action
    if (!entry) {
        return;
    }

    handler = entry.action;

    originalEvent = event.originalEvent || event;

    // simple action (via callback function)
    if (isFunction(handler)) {
        if (action === 'click') {
            handler(originalEvent, autoActivate);
        }
    } else {
        if (handler[action]) {
            handler[action](originalEvent, autoActivate);
        }
    }

    // silence other actions
    event.preventDefault();
};

CustomRealPalette.prototype._layoutChanged = function() {
    this._toggleState({});
};

/**
 * Do we need to collapse to two columns?
 *
 * @param {number} availableHeight
 * @param {Object} entries
 *
 * @return {boolean}
 */
CustomRealPalette.prototype._needsCollapse = function(availableHeight, entries) {

    // top margin + bottom toggle + bottom margin
    // implementors must override this method if they
    // change the palette styles
    var margin = 20 + 10 + 20;

    var entriesHeight = Object.keys(entries).length * 46;

    return availableHeight < entriesHeight + margin;
};

/**
 * Close the palette
 */
CustomRealPalette.prototype.close = function() {

    this._toggleState({
        open: false,
        twoColumn: false
    });
};


/**
 * Open the palette
 */
CustomRealPalette.prototype.open = function() {
    this._toggleState({ open: true });
};


CustomRealPalette.prototype.toggle = function(open) {
    if (this.isOpen()) {
        this.close();
    } else {
        this.open();
    }
};

CustomRealPalette.prototype.isActiveTool = function(tool) {
    return tool && this._activeTool === tool;
};

CustomRealPalette.prototype.updateToolHighlight = function(name) {
    var entriesContainer,
        toolsContainer;

    if (!this._toolsContainer) {
        entriesContainer = domQuery('.djs-palette-entries', this._container);

        this._toolsContainer = domQuery('[data-group=tools]', entriesContainer);
    }

    toolsContainer = this._toolsContainer;

    forEach(toolsContainer.children, function(tool) {
        var actionName = tool.getAttribute('data-action');

        if (!actionName) {
            return;
        }

        var toolClasses = domClasses(tool);

        actionName = actionName.replace('-tool', '');

        if (toolClasses.contains('entry') && actionName === name) {
            toolClasses.add('highlighted-entry');
        } else {
            toolClasses.remove('highlighted-entry');
        }
    });
};


/**
 * Return true if the palette is opened.
 *
 * @example
 *
 * palette.open();
 *
 * if (palette.isOpen()) {
 *   // yes, we are open
 * }
 *
 * @return {boolean} true if palette is opened
 */
CustomRealPalette.prototype.isOpen = function() {
    return domClasses(this._container).has(PALETTE_OPEN_CLS);
};

/**
 * Get container the palette lives in.
 *
 * @return {Element}
 */
CustomRealPalette.prototype._getParentContainer = function() {
    return this._canvas.getContainer();
};


/* markup definition */

CustomRealPalette.HTML_MARKUP =
    '<div class="djs-palette">' +
    '<div class="djs-palette-entries"></div>' +
    '<div class="djs-palette-toggle"></div>' +
    '</div>';


// helpers //////////////////////

function addClasses(element, classNames) {

    var classes = domClasses(element);

    var actualClassNames = isArray(classNames) ? classNames : classNames.split(/\s+/g);
    actualClassNames.forEach(function(cls) {
        classes.add(cls);
    });
}

function addPaletteEntries(entries, provider) {

    var entriesOrUpdater = provider.getPaletteEntries();

    if (isFunction(entriesOrUpdater)) {
        return entriesOrUpdater(entries);
    }

    forEach(entriesOrUpdater, function(entry, id) {
        entries[id] = entry;
    });

    return entries;
}
