import pkg from '../package.json' with {type:'json'};

export const WIKI_URL=pkg.homepage;
export const COMMANDS_DOC_URL=pkg.documentation.commands;
export const WIDGETS_DOC_URL=pkg.documentation.widgets;
