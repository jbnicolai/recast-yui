'use strict';

module.exports = YuiModule;

var fs = require('graceful-fs');

var recast = require('recast');
var inherits = require('inherits');
var BaseImporter = require('./base-importer');

var Promise = require('bluebird');
Promise.promisifyAll(fs);


inherits(YuiModule, BaseImporter);
function YuiModule(file) {
    if (!(this instanceof YuiModule)) {
        return new YuiModule(file);
    }

    BaseImporter.call(this, file);
}

YuiModule.prototype.visit = function (tree) {
    var instanceNodes = this.nodes;

    return recast.visit(tree, {
        visitCallExpression: function (currentPath) {
            var node = currentPath.node;
            if (node.callee &&
                node.callee.object &&
                node.callee.object.name === 'YUI' &&
                node.callee.property.name === 'add') {
                // [name, fn, version, cfg]
                var args = node.arguments;

                instanceNodes.add  = node;          // CallExpression
                instanceNodes.name = args[0];       // Literal
                instanceNodes.body = args[1].body;  // BlockStatement
                instanceNodes.meta = args[3];       // ObjectExpression

                return false; // don't visit deeper
            }

            this.traverse(currentPath);
        }
    });
};

YuiModule.prototype.deleteMeta = function () {
    if (this.cached.meta) {
        this.cached.meta = null;
    }
    var code = '',
        metaToDelete = this.nodes.meta;

    if (metaToDelete) {
        this.nodes.meta = null;

        code += this.rawcode.substring(0, this.nodes.add.arguments[2].range[1]);
        code += this.rawcode.substring(metaToDelete.range[1]);

        return fs.writeFileAsync(this.rawfile, code).bind(this)
            .tap(function () {
                console.log('deleted metadata in', this.rawfile);
            });
    }

    return this;
};

YuiModule.prototype.replaceMeta = function (tree) {
    var begins, finish, code = '';

    if (this.cached.meta) {
        this.cached.meta = null;
    }

    if (this.nodes.meta) {
        begins = this.nodes.meta.range[0];
        finish = this.nodes.meta.range[1];
    } else {
        begins = finish = this.nodes.add.range[1] - 1;
    }

    this.nodes.meta = tree;

    code += this.rawcode.substring(0, begins);

    if (this.nodes.add.arguments.length < 3) {
        // no version arg
        code += ', ""';
    }

    if (this.nodes.add.arguments.length < 4) {
        // no previous metadata
        code += ', ';
    }

    code += this.moduleMeta;
    code += this.rawcode.substring(finish);

    return fs.writeFileAsync(this.rawfile, code).bind(this)
        .tap(function () {
            console.log('replaced metadata in', this.rawfile);
        });
};

YuiModule.prototype._getters = {
    moduleName: function () {
        return this.cached.name || this.nodes.name && (
            this.cached.name = this.nodes.name.value
        );
    },

    moduleMeta: function () {
        return this.cached.meta || this.nodes.meta && (
            this.cached.meta = this.beautify(this.generate(
                this.quoteIdentifierKeys(this.nodes.meta),
                { format: { json: true } }
            ))
        );
    },

    moduleBody: function () {
        return this.cached.body || this.nodes.body && (
            this.cached.body = this.beautify(this.rawcode.substring(
                this.nodes.body.range[0] + 1,
                this.nodes.body.range[1] - 1
            ), {
                'jslint_happy': true,
                'keep_array_indentation': true
            })
        );
    }
};