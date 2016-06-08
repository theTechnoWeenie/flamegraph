(function e(t, n, r) {
    function s(o, u) {
        if (!n[o]) {
            if (!t[o]) {
                var a = typeof require == "function" && require;
                if (!u && a) return a(o, !0);
                if (i) return i(o, !0);
                var f = new Error("Cannot find module '" + o + "'");
                throw f.code = "MODULE_NOT_FOUND", f
            }
            var l = n[o] = {
                exports: {}
            };
            t[o][0].call(l.exports, function(e) {
                var n = t[o][1][e];
                return s(n ? n : e)
            }, l, l.exports, e, t, n, r)
        }
        return n[o].exports
    }
    var i = typeof require == "function" && require;
    for (var o = 0; o < r.length; o++) s(r[o]);
    return s
})({
    1: [function(require, module, exports) {
        "use strict";
        var svg = require("./lib/svg"),
            defaultOpts = require("./lib/default-opts"),
            defaultOptsMeta = require("./lib/default-opts-meta"),
            cpuprofilify = require("cpuprofilify"),
            cpuprofileProcessor = require("./lib/cpuprofile-processor");

        function fromCpuProfile(cpuprofile, opts) {
            var processed = cpuprofileProcessor(cpuprofile, opts).process();
            return svg(processed, opts)
        }
        exports = module.exports = function flamegraph(arr, opts) {
            var profile;
            if (!Array.isArray(arr)) throw new TypeError("First arg needs to be an array of lines.");
            opts = opts || {};
            try {
                profile = cpuprofilify().convert(arr, opts.profile)
            } catch (err) {
                try {
                    profile = JSON.parse(arr.join("\n"))
                } catch (parseErr) {
                    throw err
                }
            }
            return fromCpuProfile(profile, opts)
        };
        exports.svg = svg;
        exports.defaultOpts = defaultOpts;
        exports.defaultOptsMeta = defaultOptsMeta
    }, {
        "./lib/cpuprofile-processor": 4,
        "./lib/default-opts": 6,
        "./lib/default-opts-meta": 5,
        "./lib/svg": 9,
        cpuprofilify: 15
    }],
    2: [function(require, module, exports) {
        "use strict";
        var format = require("util").format;

        function scalarReverse(s) {
            return s.split("").reverse().join("")
        }

        function nameHash(name) {
            var vector = 0,
                weight = 1,
                max = 1,
                mod = 10,
                ord;
            name = name.replace(/.(.*?)`/, "");
            var splits = name.split("");
            for (var i = 0; i < splits.length; i++) {
                ord = splits[i].charCodeAt(0) % mod;
                vector += ord / (mod++ - 1) * weight;
                max += weight;
                weight *= .7;
                if (mod > 12) break
            }
            return 1 - vector / max
        }

        function color(type, hash, name) {
            var v1, v2, v3, r, g, b;
            if (!type) return "rgb(0, 0, 0)";
            if (hash) {
                v1 = nameHash(name);
                v2 = v3 = nameHash(scalarReverse(name))
            } else {
                v1 = Math.random() + 1;
                v2 = Math.random() + 1;
                v3 = Math.random() + 1
            }
            switch (type) {
                case "hot":
                    r = 205 + Math.round(50 * v3);
                    g = 0 + Math.round(230 * v1);
                    b = 0 + Math.round(55 * v2);
                    return format("rgb(%s, %s, %s)", r, g, b);
                case "mem":
                    r = 0;
                    g = 190 + Math.round(50 * v2);
                    b = 0 + Math.round(210 * v1);
                    return format("rgb(%s, %s, %s)", r, g, b);
                case "io":
                    r = 80 + Math.round(60 * v1);
                    g = r;
                    b = 190 + Math.round(55 * v2);
                    return format("rgb(%s, %s, %s)", r, g, b);
                default:
                    throw new Error("Unknown type " + type)
            }
        }
        module.exports = function colorMap(paletteMap, colorTheme, hash, func) {
            if (paletteMap[func]) return paletteMap[func];
            paletteMap[func] = color(colorTheme, hash, func);
            return paletteMap[func]
        }
    }, {
        util: 14
    }],
    3: [function(require, module, exports) {
        "use strict";
        var xtend = require("xtend"),
            format = require("util").format,
            colorMap = require("./color-map");

        function inspect(obj, depth) {
            console.error(require("util").inspect(obj, false, depth || 5, true))
        }

        function oneDecimal(x) {
            return Math.round(x * 10) / 10
        }

        function htmlEscape(s) {
            return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        }
        module.exports = function contextify(parsed, opts) {
            var time = parsed.time,
                timeMax = opts.timemax,
                ypadTop = opts.fontsize * 4,
                ypadBottom = opts.fontsize * 2 + 10,
                xpad = 10,
                depthMax = 0,
                frameHeight = opts.frameheight,
                paletteMap = {};
            if (timeMax < time && timeMax / time > .02) {
                console.error("Specified timemax %d is less than actual total %d, so it will be ignored", timeMax, time);
                timeMax = Infinity
            }
            timeMax = Math.min(time, timeMax);
            var widthPerTime = (opts.imagewidth - 2 * xpad) / timeMax,
                minWidthTime = opts.minwidth / widthPerTime;

            function markNarrowBlocks(nodes) {
                function mark(k) {
                    var val = parsed.nodes[k];
                    if (typeof val.stime !== "number") throw new Error("Missing start for " + k);
                    if (val.etime - val.stime < minWidthTime) {
                        val.narrow = true;
                        return
                    }
                    val.narrow = false;
                    depthMax = Math.max(val.depth, depthMax)
                }
                Object.keys(nodes).forEach(mark)
            }

            function processNode(node) {
                var func = node.func,
                    depth = node.depth,
                    etime = node.etime,
                    stime = node.stime,
                    factor = opts.factor,
                    countName = opts.countname,
                    isRoot = !func.length && depth === 0;
                if (isRoot) etime = timeMax;
                var samples = Math.round((etime - stime * factor) * 10) / 10,
                    samplesTxt = samples.toLocaleString(),
                    pct, pctTxt, escapedFunc, name, sampleInfo;
                if (isRoot) {
                    name = "all";
                    sampleInfo = format("(%s %s, 100%)", samplesTxt, countName)
                } else {
                    pct = Math.round(100 * samples / (timeMax * factor) * 10) / 10;
                    pctTxt = pct.toLocaleString();
                    escapedFunc = htmlEscape(func);
                    name = escapedFunc;
                    sampleInfo = format("(%s %s), %s%%)", samplesTxt, countName, pctTxt)
                }
                var x1 = oneDecimal(xpad + stime * widthPerTime),
                    x2 = oneDecimal(xpad + etime * widthPerTime),
                    y1 = oneDecimal(imageHeight - ypadBottom - (depth + 1) * frameHeight + 1),
                    y2 = oneDecimal(imageHeight - ypadBottom - depth * frameHeight),
                    chars = (x2 - x1) / (opts.fontsize * opts.fontwidth),
                    showText = false,
                    text, text_x, text_y;
                if (chars >= 3) {
                    showText = true;
                    text = func.slice(0, chars);
                    if (chars < func.length) text = text.slice(0, chars - 2) + "..";
                    text = htmlEscape(text)
                }
                return {
                    name: name,
                    search: name.toLowerCase(),
                    samples: sampleInfo,
                    rect_x: x1,
                    rect_y: y1,
                    rect_w: x2 - x1,
                    rect_h: y2 - y1,
                    rect_fill: colorMap(paletteMap, opts.colors, opts.hash, func),
                    text: text,
                    text_x: x1 + (showText ? 3 : 0),
                    text_y: 3 + (y1 + y2) / 2,
                    narrow: node.narrow,
                    func: htmlEscape(func)
                }
            }

            function processNodes(nodes) {
                var keys = Object.keys(nodes),
                    acc = new Array(keys.length);
                for (var i = 0; i < keys.length; i++) acc[i] = processNode(nodes[keys[i]]);
                return acc
            }
            markNarrowBlocks(parsed.nodes);
            var imageHeight = depthMax * frameHeight + ypadTop + ypadBottom;
            var ctx = xtend(opts, {
                imageheight: imageHeight,
                xpad: xpad,
                titleX: opts.imagewidth / 2,
                detailsY: imageHeight - frameHeight / 2
            });
            ctx.nodes = processNodes(parsed.nodes);
            return ctx
        }
    }, {
        "./color-map": 2,
        util: 14,
        xtend: 41
    }],
    4: [function(require, module, exports) {
        "use strict";

        function funcName(node) {
            var n = node.functionName;
            if (node.url) n += " " + node.url + ":" + node.lineNumber;
            return n
        }

        function byFramesLexically(a, b) {
            var i = 0,
                framesA = a.frames,
                framesB = b.frames;
            while (true) {
                if (!framesA[i]) return -1;
                if (!framesB[i]) return 1;
                if (framesA[i] < framesB[i]) return -1;
                if (framesB[i] < framesA[i]) return 1;
                i++
            }
        }

        function sort(functions) {
            return functions.sort(byFramesLexically)
        }

        function CpuProfileProcessor(cpuprofile) {
            if (!(this instanceof CpuProfileProcessor)) return new CpuProfileProcessor(cpuprofile);
            this._profile = cpuprofile;
            this._paths = [];
            this._time = 0;
            this._last = [];
            this._tmp = {};
            this._nodes = {}
        }
        var proto = CpuProfileProcessor.prototype;
        module.exports = CpuProfileProcessor;
        proto._explorePaths = function _explorePaths(node, stack) {
            stack.push(funcName(node));
            if (node.hitCount) this._paths.push({
                frames: stack.slice(),
                hitCount: node.hitCount
            });
            for (var i = 0; i < node.children.length; i++) this._explorePaths(node.children[i], stack);
            stack.pop()
        };
        proto._flow = function _flow(frames) {
            var lenLast = this._last.length - 1,
                lenFrames = frames.length - 1,
                i, lenSame, k;
            for (i = 0; i <= lenLast; i++) {
                if (i > lenFrames) break;
                if (this._last[i] !== frames[i]) break
            }
            lenSame = i;
            for (i = lenLast; i >= lenSame; i--) {
                k = this._last[i] + ";" + i;
                this._nodes[k + ";" + this._time] = {
                    func: this._last[i],
                    depth: i,
                    etime: this._time,
                    stime: this._tmp[k].stime
                };
                this._tmp[k] = null
            }
            for (i = lenSame; i <= lenFrames; i++) {
                k = frames[i] + ";" + i;
                this._tmp[k] = {
                    stime: this._time
                }
            }
        };
        proto._processPath = function _processPath(path) {
            this._flow(path.frames);
            this._time += path.hitCount;
            this._last = path.frames
        };
        proto._processPaths = function _processPaths() {
            sort(this._paths);
            for (var i = 0; i < this._paths.length; i++) this._processPath(this._paths[i]);
            this._flow([])
        };
        proto.process = function process() {
            this._explorePaths(this._profile.head, []);
            this._processPaths();
            return {
                nodes: this._nodes,
                time: this._time
            }
        }
    }, {}],
    5: [function(require, module, exports) {
        "use strict";
        module.exports = {
            fonttype: {
                type: "string",
                description: "Font Type"
            },
            fontsize: {
                type: "range",
                description: "Font Size",
                min: 6,
                max: 22,
                step: .1
            },
            imagewidth: {
                type: "range",
                description: "Image Width",
                min: 200,
                max: 2400,
                step: 5
            },
            frameheight: {
                type: "range",
                description: "Frame Height",
                min: 6,
                max: 40,
                step: .1
            },
            fontwidth: {
                type: "range",
                description: "Font Width",
                min: .2,
                max: 1,
                step: .05
            },
            minwidth: {
                type: "range",
                description: "Min Function Width",
                min: .1,
                max: 30,
                step: .1
            },
            countname: {
                type: "string",
                description: "Count Name"
            },
            colors: {
                type: "string",
                description: "Color Theme"
            },
            bgcolor1: {
                type: "color",
                description: "Gradient start"
            },
            bgcolor2: {
                type: "color",
                description: "Gradient stop"
            },
            timemax: {
                type: "number",
                description: "Time Max"
            },
            factor: {
                type: "number",
                description: "Scaling Factor"
            },
            hash: {
                type: "boolean",
                description: "Color by Function Name"
            },
            titlestring: {
                type: "string",
                description: "Title"
            },
            nametype: {
                type: "string",
                description: "Name"
            },
            internals: {
                type: "checkbox",
                description: "Show Internals",
                checked: ""
            }
        }
    }, {}],
    6: [function(require, module, exports) {
        "use strict";
        module.exports = {
            fonttype: "Verdana",
            fontsize: 12,
            imagewidth: 1200,
            frameheight: 16,
            fontwidth: .59,
            minwidth: .1,
            countname: "samples",
            colors: "hot",
            bgcolor1: "#eeeeee",
            bgcolor2: "#eeeeb0",
            timemax: Infinity,
            factor: 1,
            hash: true,
            titletext: "Flame Graph",
            nametype: "Function:",
            palette: false,
            palette_map: {},
            pal_file: "palette.map",
            removenarrows: true,
            profile: {
                shortStack: true,
                unresolveds: false,
                v8internals: false,
                v8gc: true,
                sysinternals: false
            }
        }
    }, {}],
    7: [function(require, module, exports) {
        "use strict";
        module.exports = require("./svg.hbs")
    }, {
        "./svg.hbs": 8
    }],
    8: [function(require, module, exports) {
        var Handlebars = require("hbsfy/runtime");
        module.exports = Handlebars.template({
            1: function(depth0, helpers, partials, data, depths) {
                var stack1, helper, functionType = "function",
                    helperMissing = helpers.helperMissing,
                    escapeExpression = this.escapeExpression,
                    lambda = this.lambda,
                    buffer = '<g class="func_g ' + escapeExpression((helper = (helper = helpers["class"] || (depth0 != null ? depth0["class"] : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "class",
                        hash: {},
                        data: data
                    }) : helper)) + '" onmouseover="s(\'';
                stack1 = (helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "name",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += " ";
                stack1 = (helper = (helper = helpers.samples || (depth0 != null ? depth0.samples : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "samples",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += '\')" onmouseout="c()" data-search="';
                stack1 = (helper = (helper = helpers.search || (depth0 != null ? depth0.search : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "search",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += '" data-funcname="';
                stack1 = (helper = (helper = helpers.func || (depth0 != null ? depth0.func : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "func",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += '">\n  <title>';
                stack1 = (helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "name",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += " ";
                stack1 = (helper = (helper = helpers.samples || (depth0 != null ? depth0.samples : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "samples",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += '</title>\n  <rect x="' + escapeExpression((helper = (helper = helpers.rect_x || (depth0 != null ? depth0.rect_x : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_x",
                    hash: {},
                    data: data
                }) : helper)) + '" data-x="' + escapeExpression((helper = (helper = helpers.rect_x || (depth0 != null ? depth0.rect_x : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_x",
                    hash: {},
                    data: data
                }) : helper)) + '" y="' + escapeExpression((helper = (helper = helpers.rect_y || (depth0 != null ? depth0.rect_y : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_y",
                    hash: {},
                    data: data
                }) : helper)) + '" width="' + escapeExpression((helper = (helper = helpers.rect_w || (depth0 != null ? depth0.rect_w : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_w",
                    hash: {},
                    data: data
                }) : helper)) + '" data-width="' + escapeExpression((helper = (helper = helpers.rect_w || (depth0 != null ? depth0.rect_w : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_w",
                    hash: {},
                    data: data
                }) : helper)) + '" height="' + escapeExpression((helper = (helper = helpers.rect_h || (depth0 != null ? depth0.rect_h : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_h",
                    hash: {},
                    data: data
                }) : helper)) + '" data-height="' + escapeExpression((helper = (helper = helpers.rect_h || (depth0 != null ? depth0.rect_h : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_h",
                    hash: {},
                    data: data
                }) : helper)) + '" fill="' + escapeExpression((helper = (helper = helpers.rect_fill || (depth0 != null ? depth0.rect_fill : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "rect_fill",
                    hash: {},
                    data: data
                }) : helper)) + '" rx="2" ry="2"></rect>\n  <text data-x="' + escapeExpression((helper = (helper = helpers.text_x || (depth0 != null ? depth0.text_x : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "text_x",
                    hash: {},
                    data: data
                }) : helper)) + '" x="' + escapeExpression((helper = (helper = helpers.text_x || (depth0 != null ? depth0.text_x : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "text_x",
                    hash: {},
                    data: data
                }) : helper)) + '" y="' + escapeExpression((helper = (helper = helpers.text_y || (depth0 != null ? depth0.text_y : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "text_y",
                    hash: {},
                    data: data
                }) : helper)) + '" font-size="' + escapeExpression(lambda(depths[1] != null ? depths[1].fontsize : depths[1], depth0)) + '" font-family="' + escapeExpression(lambda(depths[1] != null ? depths[1].fonttype : depths[1], depth0)) + '" fill="rgb(0,0,0)">';
                stack1 = (helper = (helper = helpers.text || (depth0 != null ? depth0.text : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "text",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                return buffer + "</text>\n</g>\n"
            },
            compiler: [6, ">= 2.0.0-beta.1"],
            main: function(depth0, helpers, partials, data, depths) {
                var stack1, helper, functionType = "function",
                    helperMissing = helpers.helperMissing,
                    escapeExpression = this.escapeExpression,
                    buffer = '<?xml version="1.0" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n\n<svg version="1.1" id="flamegraph-svg" \n  data-width="' + escapeExpression((helper = (helper = helpers.imagewidth || (depth0 != null ? depth0.imagewidth : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imagewidth",
                        hash: {},
                        data: data
                    }) : helper)) + '" width="' + escapeExpression((helper = (helper = helpers.imagewidth || (depth0 != null ? depth0.imagewidth : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imagewidth",
                        hash: {},
                        data: data
                    }) : helper)) + '" \n  height="' + escapeExpression((helper = (helper = helpers.imageheight || (depth0 != null ? depth0.imageheight : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imageheight",
                        hash: {},
                        data: data
                    }) : helper)) + '" data-height="' + escapeExpression((helper = (helper = helpers.imageheight || (depth0 != null ? depth0.imageheight : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imageheight",
                        hash: {},
                        data: data
                    }) : helper)) + '"\n  onload="init(evt)" \n  viewBox="0 0 ' + escapeExpression((helper = (helper = helpers.imagewidth || (depth0 != null ? depth0.imagewidth : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imagewidth",
                        hash: {},
                        data: data
                    }) : helper)) + " " + escapeExpression((helper = (helper = helpers.imageheight || (depth0 != null ? depth0.imageheight : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imageheight",
                        hash: {},
                        data: data
                    }) : helper)) + '" \n  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n\n<defs>\n	<linearGradient id="background" y1="0" y2="1" x1="0" x2="0">\n    <stop stop-color="' + escapeExpression((helper = (helper = helpers.bgcolor1 || (depth0 != null ? depth0.bgcolor1 : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "bgcolor1",
                        hash: {},
                        data: data
                    }) : helper)) + '" offset="5%" />\n    <stop stop-color="' + escapeExpression((helper = (helper = helpers.bgcolor2 || (depth0 != null ? depth0.bgcolor2 : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "bgcolor2",
                        hash: {},
                        data: data
                    }) : helper)) + '" offset="95%" />\n	</linearGradient>\n</defs>\n<style type="text/css">\n	.func_g:hover { stroke:black; stroke-width:0.5; }\n</style>\n<script type="text/javascript">\n	var details;\n	function init(evt) { details = document.getElementById("details").firstChild; }\n  function s(info) { details.nodeValue = "' + escapeExpression((helper = (helper = helpers.nametype || (depth0 != null ? depth0.nametype : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "nametype",
                        hash: {},
                        data: data
                    }) : helper)) + ': " + info; }\n	function c() { details.nodeValue = \' \'; }\n</script>\n\n<rect x="0.0" y="0" id="svg-background" width="' + escapeExpression((helper = (helper = helpers.imagewidth || (depth0 != null ? depth0.imagewidth : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imagewidth",
                        hash: {},
                        data: data
                    }) : helper)) + '" height="' + escapeExpression((helper = (helper = helpers.imageheight || (depth0 != null ? depth0.imageheight : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "imageheight",
                        hash: {},
                        data: data
                    }) : helper)) + '" fill="url(#background)"  />\n<!--<text text-anchor="middle" x="' + escapeExpression((helper = (helper = helpers.titleX || (depth0 != null ? depth0.titleX : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "titleX",
                        hash: {},
                        data: data
                    }) : helper)) + '" y="24" font-size="17" font-family="' + escapeExpression((helper = (helper = helpers.fonttype || (depth0 != null ? depth0.fonttype : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                        name: "fonttype",
                        hash: {},
                        data: data
                    }) : helper)) + '" fill="rgb(0,0,0)">';
                stack1 = (helper = (helper = helpers.titletext || (depth0 != null ? depth0.titletext : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "titletext",
                    hash: {},
                    data: data
                }) : helper);
                if (stack1 != null) {
                    buffer += stack1
                }
                buffer += '</text>-->\n<text text-anchor="left" x="' + escapeExpression((helper = (helper = helpers.xpad || (depth0 != null ? depth0.xpad : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "xpad",
                    hash: {},
                    data: data
                }) : helper)) + '" y="' + escapeExpression((helper = (helper = helpers.detailsY || (depth0 != null ? depth0.detailsY : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "detailsY",
                    hash: {},
                    data: data
                }) : helper)) + '" font-size="' + escapeExpression((helper = (helper = helpers.fontsize || (depth0 != null ? depth0.fontsize : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "fontsize",
                    hash: {},
                    data: data
                }) : helper)) + '" font-family="' + escapeExpression((helper = (helper = helpers.fonttype || (depth0 != null ? depth0.fonttype : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "fonttype",
                    hash: {},
                    data: data
                }) : helper)) + '" fill="rgb(0,0,0)" id="details"> </text>\n\n';
                stack1 = helpers.each.call(depth0, depth0 != null ? depth0.nodes : depth0, {
                    name: "each",
                    hash: {},
                    fn: this.program(1, data, depths),
                    inverse: this.noop,
                    data: data
                });
                if (stack1 != null) {
                    buffer += stack1
                }
                return buffer + "\n</svg>\n"
            },
            useData: true,
            useDepths: true
        })
    }, {
        "hbsfy/runtime": 38
    }],
    9: [function(require, module, exports) {
        "use strict";
        var xtend = require("xtend"),
            contextify = require("./contextify"),
            svgTemplate = require("./svg-template"),
            defaultOpts = require("./default-opts");

        function narrowify(context, opts) {
            function processNode(n) {
                n.class = n.narrow ? "hidden" : ""
            }

            function filterNode(n) {
                return !n.narrow
            }
            if (opts.removenarrows) context.nodes = context.nodes.filter(filterNode);
            else context.nodes.forEach(processNode)
        }
        var go = module.exports = function svg(processedCpuProfile, opts) {
            opts = xtend(defaultOpts, opts);
            var context = contextify(processedCpuProfile, opts);
            narrowify(context, opts);
            return svgTemplate(context)
        }
    }, {
        "./contextify": 3,
        "./default-opts": 6,
        "./svg-template": 7,
        xtend: 41
    }],
    10: [function(require, module, exports) {
        function EventEmitter() {
            this._events = this._events || {};
            this._maxListeners = this._maxListeners || undefined
        }
        module.exports = EventEmitter;
        EventEmitter.EventEmitter = EventEmitter;
        EventEmitter.prototype._events = undefined;
        EventEmitter.prototype._maxListeners = undefined;
        EventEmitter.defaultMaxListeners = 10;
        EventEmitter.prototype.setMaxListeners = function(n) {
            if (!isNumber(n) || n < 0 || isNaN(n)) throw TypeError("n must be a positive number");
            this._maxListeners = n;
            return this
        };
        EventEmitter.prototype.emit = function(type) {
            var er, handler, len, args, i, listeners;
            if (!this._events) this._events = {};
            if (type === "error") {
                if (!this._events.error || isObject(this._events.error) && !this._events.error.length) {
                    er = arguments[1];
                    if (er instanceof Error) {
                        throw er
                    }
                    throw TypeError('Uncaught, unspecified "error" event.')
                }
            }
            handler = this._events[type];
            if (isUndefined(handler)) return false;
            if (isFunction(handler)) {
                switch (arguments.length) {
                    case 1:
                        handler.call(this);
                        break;
                    case 2:
                        handler.call(this, arguments[1]);
                        break;
                    case 3:
                        handler.call(this, arguments[1], arguments[2]);
                        break;
                    default:
                        len = arguments.length;
                        args = new Array(len - 1);
                        for (i = 1; i < len; i++) args[i - 1] = arguments[i];
                        handler.apply(this, args)
                }
            } else if (isObject(handler)) {
                len = arguments.length;
                args = new Array(len - 1);
                for (i = 1; i < len; i++) args[i - 1] = arguments[i];
                listeners = handler.slice();
                len = listeners.length;
                for (i = 0; i < len; i++) listeners[i].apply(this, args)
            }
            return true
        };
        EventEmitter.prototype.addListener = function(type, listener) {
            var m;
            if (!isFunction(listener)) throw TypeError("listener must be a function");
            if (!this._events) this._events = {};
            if (this._events.newListener) this.emit("newListener", type, isFunction(listener.listener) ? listener.listener : listener);
            if (!this._events[type]) this._events[type] = listener;
            else if (isObject(this._events[type])) this._events[type].push(listener);
            else this._events[type] = [this._events[type], listener];
            if (isObject(this._events[type]) && !this._events[type].warned) {
                var m;
                if (!isUndefined(this._maxListeners)) {
                    m = this._maxListeners
                } else {
                    m = EventEmitter.defaultMaxListeners
                }
                if (m && m > 0 && this._events[type].length > m) {
                    this._events[type].warned = true;
                    console.error("(node) warning: possible EventEmitter memory " + "leak detected. %d listeners added. " + "Use emitter.setMaxListeners() to increase limit.", this._events[type].length);
                    if (typeof console.trace === "function") {
                        console.trace()
                    }
                }
            }
            return this
        };
        EventEmitter.prototype.on = EventEmitter.prototype.addListener;
        EventEmitter.prototype.once = function(type, listener) {
            if (!isFunction(listener)) throw TypeError("listener must be a function");
            var fired = false;

            function g() {
                this.removeListener(type, g);
                if (!fired) {
                    fired = true;
                    listener.apply(this, arguments)
                }
            }
            g.listener = listener;
            this.on(type, g);
            return this
        };
        EventEmitter.prototype.removeListener = function(type, listener) {
            var list, position, length, i;
            if (!isFunction(listener)) throw TypeError("listener must be a function");
            if (!this._events || !this._events[type]) return this;
            list = this._events[type];
            length = list.length;
            position = -1;
            if (list === listener || isFunction(list.listener) && list.listener === listener) {
                delete this._events[type];
                if (this._events.removeListener) this.emit("removeListener", type, listener)
            } else if (isObject(list)) {
                for (i = length; i-- > 0;) {
                    if (list[i] === listener || list[i].listener && list[i].listener === listener) {
                        position = i;
                        break
                    }
                }
                if (position < 0) return this;
                if (list.length === 1) {
                    list.length = 0;
                    delete this._events[type]
                } else {
                    list.splice(position, 1)
                }
                if (this._events.removeListener) this.emit("removeListener", type, listener)
            }
            return this
        };
        EventEmitter.prototype.removeAllListeners = function(type) {
            var key, listeners;
            if (!this._events) return this;
            if (!this._events.removeListener) {
                if (arguments.length === 0) this._events = {};
                else if (this._events[type]) delete this._events[type];
                return this
            }
            if (arguments.length === 0) {
                for (key in this._events) {
                    if (key === "removeListener") continue;
                    this.removeAllListeners(key)
                }
                this.removeAllListeners("removeListener");
                this._events = {};
                return this
            }
            listeners = this._events[type];
            if (isFunction(listeners)) {
                this.removeListener(type, listeners)
            } else {
                while (listeners.length) this.removeListener(type, listeners[listeners.length - 1])
            }
            delete this._events[type];
            return this
        };
        EventEmitter.prototype.listeners = function(type) {
            var ret;
            if (!this._events || !this._events[type]) ret = [];
            else if (isFunction(this._events[type])) ret = [this._events[type]];
            else ret = this._events[type].slice();
            return ret
        };
        EventEmitter.listenerCount = function(emitter, type) {
            var ret;
            if (!emitter._events || !emitter._events[type]) ret = 0;
            else if (isFunction(emitter._events[type])) ret = 1;
            else ret = emitter._events[type].length;
            return ret
        };

        function isFunction(arg) {
            return typeof arg === "function"
        }

        function isNumber(arg) {
            return typeof arg === "number"
        }

        function isObject(arg) {
            return typeof arg === "object" && arg !== null
        }

        function isUndefined(arg) {
            return arg === void 0
        }
    }, {}],
    11: [function(require, module, exports) {
        if (typeof Object.create === "function") {
            module.exports = function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                ctor.prototype = Object.create(superCtor.prototype, {
                    constructor: {
                        value: ctor,
                        enumerable: false,
                        writable: true,
                        configurable: true
                    }
                })
            }
        } else {
            module.exports = function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                var TempCtor = function() {};
                TempCtor.prototype = superCtor.prototype;
                ctor.prototype = new TempCtor;
                ctor.prototype.constructor = ctor
            }
        }
    }, {}],
    12: [function(require, module, exports) {
        var process = module.exports = {};
        process.nextTick = function() {
            var canSetImmediate = typeof window !== "undefined" && window.setImmediate;
            var canMutationObserver = typeof window !== "undefined" && window.MutationObserver;
            var canPost = typeof window !== "undefined" && window.postMessage && window.addEventListener;
            if (canSetImmediate) {
                return function(f) {
                    return window.setImmediate(f)
                }
            }
            var queue = [];
            if (canMutationObserver) {
                var hiddenDiv = document.createElement("div");
                var observer = new MutationObserver(function() {
                    var queueList = queue.slice();
                    queue.length = 0;
                    queueList.forEach(function(fn) {
                        fn()
                    })
                });
                observer.observe(hiddenDiv, {
                    attributes: true
                });
                return function nextTick(fn) {
                    if (!queue.length) {
                        hiddenDiv.setAttribute("yes", "no")
                    }
                    queue.push(fn)
                }
            }
            if (canPost) {
                window.addEventListener("message", function(ev) {
                    var source = ev.source;
                    if ((source === window || source === null) && ev.data === "process-tick") {
                        ev.stopPropagation();
                        if (queue.length > 0) {
                            var fn = queue.shift();
                            fn()
                        }
                    }
                }, true);
                return function nextTick(fn) {
                    queue.push(fn);
                    window.postMessage("process-tick", "*")
                }
            }
            return function nextTick(fn) {
                setTimeout(fn, 0)
            }
        }();
        process.title = "browser";
        process.browser = true;
        process.env = {};
        process.argv = [];

        function noop() {}
        process.on = noop;
        process.addListener = noop;
        process.once = noop;
        process.off = noop;
        process.removeListener = noop;
        process.removeAllListeners = noop;
        process.emit = noop;
        process.binding = function(name) {
            throw new Error("process.binding is not supported")
        };
        process.cwd = function() {
            return "/"
        };
        process.chdir = function(dir) {
            throw new Error("process.chdir is not supported")
        }
    }, {}],
    13: [function(require, module, exports) {
        module.exports = function isBuffer(arg) {
            return arg && typeof arg === "object" && typeof arg.copy === "function" && typeof arg.fill === "function" && typeof arg.readUInt8 === "function"
        }
    }, {}],
    14: [function(require, module, exports) {
        (function(process, global) {
            var formatRegExp = /%[sdj%]/g;
            exports.format = function(f) {
                if (!isString(f)) {
                    var objects = [];
                    for (var i = 0; i < arguments.length; i++) {
                        objects.push(inspect(arguments[i]))
                    }
                    return objects.join(" ")
                }
                var i = 1;
                var args = arguments;
                var len = args.length;
                var str = String(f).replace(formatRegExp, function(x) {
                    if (x === "%%") return "%";
                    if (i >= len) return x;
                    switch (x) {
                        case "%s":
                            return String(args[i++]);
                        case "%d":
                            return Number(args[i++]);
                        case "%j":
                            try {
                                return JSON.stringify(args[i++])
                            } catch (_) {
                                return "[Circular]"
                            }
                        default:
                            return x
                    }
                });
                for (var x = args[i]; i < len; x = args[++i]) {
                    if (isNull(x) || !isObject(x)) {
                        str += " " + x
                    } else {
                        str += " " + inspect(x)
                    }
                }
                return str
            };
            exports.deprecate = function(fn, msg) {
                if (isUndefined(global.process)) {
                    return function() {
                        return exports.deprecate(fn, msg).apply(this, arguments)
                    }
                }
                if (process.noDeprecation === true) {
                    return fn
                }
                var warned = false;

                function deprecated() {
                    if (!warned) {
                        if (process.throwDeprecation) {
                            throw new Error(msg)
                        } else if (process.traceDeprecation) {
                            console.trace(msg)
                        } else {
                            console.error(msg)
                        }
                        warned = true
                    }
                    return fn.apply(this, arguments)
                }
                return deprecated
            };
            var debugs = {};
            var debugEnviron;
            exports.debuglog = function(set) {
                if (isUndefined(debugEnviron)) debugEnviron = process.env.NODE_DEBUG || "";
                set = set.toUpperCase();
                if (!debugs[set]) {
                    if (new RegExp("\\b" + set + "\\b", "i").test(debugEnviron)) {
                        var pid = process.pid;
                        debugs[set] = function() {
                            var msg = exports.format.apply(exports, arguments);
                            console.error("%s %d: %s", set, pid, msg)
                        }
                    } else {
                        debugs[set] = function() {}
                    }
                }
                return debugs[set]
            };

            function inspect(obj, opts) {
                var ctx = {
                    seen: [],
                    stylize: stylizeNoColor
                };
                if (arguments.length >= 3) ctx.depth = arguments[2];
                if (arguments.length >= 4) ctx.colors = arguments[3];
                if (isBoolean(opts)) {
                    ctx.showHidden = opts
                } else if (opts) {
                    exports._extend(ctx, opts)
                }
                if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
                if (isUndefined(ctx.depth)) ctx.depth = 2;
                if (isUndefined(ctx.colors)) ctx.colors = false;
                if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
                if (ctx.colors) ctx.stylize = stylizeWithColor;
                return formatValue(ctx, obj, ctx.depth)
            }
            exports.inspect = inspect;
            inspect.colors = {
                bold: [1, 22],
                italic: [3, 23],
                underline: [4, 24],
                inverse: [7, 27],
                white: [37, 39],
                grey: [90, 39],
                black: [30, 39],
                blue: [34, 39],
                cyan: [36, 39],
                green: [32, 39],
                magenta: [35, 39],
                red: [31, 39],
                yellow: [33, 39]
            };
            inspect.styles = {
                special: "cyan",
                number: "yellow",
                "boolean": "yellow",
                undefined: "grey",
                "null": "bold",
                string: "green",
                date: "magenta",
                regexp: "red"
            };

            function stylizeWithColor(str, styleType) {
                var style = inspect.styles[styleType];
                if (style) {
                    return "[" + inspect.colors[style][0] + "m" + str + "[" + inspect.colors[style][1] + "m"
                } else {
                    return str
                }
            }

            function stylizeNoColor(str, styleType) {
                return str
            }

            function arrayToHash(array) {
                var hash = {};
                array.forEach(function(val, idx) {
                    hash[val] = true
                });
                return hash
            }

            function formatValue(ctx, value, recurseTimes) {
                if (ctx.customInspect && value && isFunction(value.inspect) && value.inspect !== exports.inspect && !(value.constructor && value.constructor.prototype === value)) {
                    var ret = value.inspect(recurseTimes, ctx);
                    if (!isString(ret)) {
                        ret = formatValue(ctx, ret, recurseTimes)
                    }
                    return ret
                }
                var primitive = formatPrimitive(ctx, value);
                if (primitive) {
                    return primitive
                }
                var keys = Object.keys(value);
                var visibleKeys = arrayToHash(keys);
                if (ctx.showHidden) {
                    keys = Object.getOwnPropertyNames(value)
                }
                if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
                    return formatError(value)
                }
                if (keys.length === 0) {
                    if (isFunction(value)) {
                        var name = value.name ? ": " + value.name : "";
                        return ctx.stylize("[Function" + name + "]", "special")
                    }
                    if (isRegExp(value)) {
                        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp")
                    }
                    if (isDate(value)) {
                        return ctx.stylize(Date.prototype.toString.call(value), "date")
                    }
                    if (isError(value)) {
                        return formatError(value)
                    }
                }
                var base = "",
                    array = false,
                    braces = ["{", "}"];
                if (isArray(value)) {
                    array = true;
                    braces = ["[", "]"]
                }
                if (isFunction(value)) {
                    var n = value.name ? ": " + value.name : "";
                    base = " [Function" + n + "]"
                }
                if (isRegExp(value)) {
                    base = " " + RegExp.prototype.toString.call(value)
                }
                if (isDate(value)) {
                    base = " " + Date.prototype.toUTCString.call(value)
                }
                if (isError(value)) {
                    base = " " + formatError(value)
                }
                if (keys.length === 0 && (!array || value.length == 0)) {
                    return braces[0] + base + braces[1]
                }
                if (recurseTimes < 0) {
                    if (isRegExp(value)) {
                        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp")
                    } else {
                        return ctx.stylize("[Object]", "special")
                    }
                }
                ctx.seen.push(value);
                var output;
                if (array) {
                    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys)
                } else {
                    output = keys.map(function(key) {
                        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array)
                    })
                }
                ctx.seen.pop();
                return reduceToSingleString(output, base, braces)
            }

            function formatPrimitive(ctx, value) {
                if (isUndefined(value)) return ctx.stylize("undefined", "undefined");
                if (isString(value)) {
                    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
                    return ctx.stylize(simple, "string")
                }
                if (isNumber(value)) return ctx.stylize("" + value, "number");
                if (isBoolean(value)) return ctx.stylize("" + value, "boolean");
                if (isNull(value)) return ctx.stylize("null", "null")
            }

            function formatError(value) {
                return "[" + Error.prototype.toString.call(value) + "]"
            }

            function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
                var output = [];
                for (var i = 0, l = value.length; i < l; ++i) {
                    if (hasOwnProperty(value, String(i))) {
                        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true))
                    } else {
                        output.push("")
                    }
                }
                keys.forEach(function(key) {
                    if (!key.match(/^\d+$/)) {
                        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true))
                    }
                });
                return output
            }

            function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
                var name, str, desc;
                desc = Object.getOwnPropertyDescriptor(value, key) || {
                    value: value[key]
                };
                if (desc.get) {
                    if (desc.set) {
                        str = ctx.stylize("[Getter/Setter]", "special")
                    } else {
                        str = ctx.stylize("[Getter]", "special")
                    }
                } else {
                    if (desc.set) {
                        str = ctx.stylize("[Setter]", "special")
                    }
                }
                if (!hasOwnProperty(visibleKeys, key)) {
                    name = "[" + key + "]"
                }
                if (!str) {
                    if (ctx.seen.indexOf(desc.value) < 0) {
                        if (isNull(recurseTimes)) {
                            str = formatValue(ctx, desc.value, null)
                        } else {
                            str = formatValue(ctx, desc.value, recurseTimes - 1)
                        }
                        if (str.indexOf("\n") > -1) {
                            if (array) {
                                str = str.split("\n").map(function(line) {
                                    return "  " + line
                                }).join("\n").substr(2)
                            } else {
                                str = "\n" + str.split("\n").map(function(line) {
                                    return "   " + line
                                }).join("\n")
                            }
                        }
                    } else {
                        str = ctx.stylize("[Circular]", "special")
                    }
                }
                if (isUndefined(name)) {
                    if (array && key.match(/^\d+$/)) {
                        return str
                    }
                    name = JSON.stringify("" + key);
                    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
                        name = name.substr(1, name.length - 2);
                        name = ctx.stylize(name, "name")
                    } else {
                        name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
                        name = ctx.stylize(name, "string")
                    }
                }
                return name + ": " + str
            }

            function reduceToSingleString(output, base, braces) {
                var numLinesEst = 0;
                var length = output.reduce(function(prev, cur) {
                    numLinesEst++;
                    if (cur.indexOf("\n") >= 0) numLinesEst++;
                    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1
                }, 0);
                if (length > 60) {
                    return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1]
                }
                return braces[0] + base + " " + output.join(", ") + " " + braces[1]
            }

            function isArray(ar) {
                return Array.isArray(ar)
            }
            exports.isArray = isArray;

            function isBoolean(arg) {
                return typeof arg === "boolean"
            }
            exports.isBoolean = isBoolean;

            function isNull(arg) {
                return arg === null
            }
            exports.isNull = isNull;

            function isNullOrUndefined(arg) {
                return arg == null
            }
            exports.isNullOrUndefined = isNullOrUndefined;

            function isNumber(arg) {
                return typeof arg === "number"
            }
            exports.isNumber = isNumber;

            function isString(arg) {
                return typeof arg === "string"
            }
            exports.isString = isString;

            function isSymbol(arg) {
                return typeof arg === "symbol"
            }
            exports.isSymbol = isSymbol;

            function isUndefined(arg) {
                return arg === void 0
            }
            exports.isUndefined = isUndefined;

            function isRegExp(re) {
                return isObject(re) && objectToString(re) === "[object RegExp]"
            }
            exports.isRegExp = isRegExp;

            function isObject(arg) {
                return typeof arg === "object" && arg !== null
            }
            exports.isObject = isObject;

            function isDate(d) {
                return isObject(d) && objectToString(d) === "[object Date]"
            }
            exports.isDate = isDate;

            function isError(e) {
                return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error)
            }
            exports.isError = isError;

            function isFunction(arg) {
                return typeof arg === "function"
            }
            exports.isFunction = isFunction;

            function isPrimitive(arg) {
                return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || typeof arg === "undefined"
            }
            exports.isPrimitive = isPrimitive;
            exports.isBuffer = require("./support/isBuffer");

            function objectToString(o) {
                return Object.prototype.toString.call(o)
            }

            function pad(n) {
                return n < 10 ? "0" + n.toString(10) : n.toString(10)
            }
            var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            function timestamp() {
                var d = new Date;
                var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
                return [d.getDate(), months[d.getMonth()], time].join(" ")
            }
            exports.log = function() {
                console.log("%s - %s", timestamp(), exports.format.apply(exports, arguments))
            };
            exports.inherits = require("inherits");
            exports._extend = function(origin, add) {
                if (!add || !isObject(add)) return origin;
                var keys = Object.keys(add);
                var i = keys.length;
                while (i--) {
                    origin[keys[i]] = add[keys[i]]
                }
                return origin
            };

            function hasOwnProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop)
            }
        }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, {
        "./support/isBuffer": 13,
        _process: 12,
        inherits: 11
    }],
    15: [function(require, module, exports) {
        "use strict";
        var filterInternals = require("trace-filter-internals"),
            traceUtil = require("./lib/trace-util"),
            getConverter = require("./lib/get-converter"),
            resolveSymbols = require("./lib/resolve-symbols"),
            resolveSymbolsFromMap = require("./lib/resolve-symbols-from-map"),
            xtend = require("xtend"),
            inherits = require("inherits"),
            EventEmitter = require("events").EventEmitter;

        function CpuProfilifier() {
            if (!(this instanceof CpuProfilifier)) return new CpuProfilifier;
            EventEmitter.call(this)
        }
        inherits(CpuProfilifier, EventEmitter);
        var proto = CpuProfilifier.prototype;
        module.exports = CpuProfilifier;
        proto.convert = function convert(trace, opts) {
            opts = opts || {};
            this._map = opts.map;
            this._opts = xtend({
                v8gc: true
            }, opts, {
                map: this._map ? "was supplied" : "was not supplied"
            });
            this.emit("info", "Options: %j", this._opts);
            this._trace = trace;
            this._traceLen = trace.length;
            if (!this._traceLen) {
                this.emit("warn", "Trace was empty, quitting");
                return
            }
            try {
                this._traceStart = traceUtil.traceStart(this._trace);
                this._converterCtr = getConverter(this._trace, this._traceStart, this._opts.type);
                if (this._converterCtr.proto.type === "instruments") this.emit("warn", "You are converting an instruments callgraph.\n" + "It only contain aggregation data but no timeline.\n" + "However a timeline from 0s-5s will appear when loaded in DevTools.\n" + "It will not show the true execution order. Please be aware!");
                this._resolveTraceInfo();
                this._tryResolveSymbols();
                this._filterInternals();
                var converter = this._converterCtr(this._filtered, this._traceStart, this._opts);
                this.emit("info", "Converting trace of length %d", this._filteredLen);
                var converted = converter.convert();
                this.emit("info", "Success!");
                return converted
            } catch (err) {
                this.emit("error", err)
            }
        };
        proto._tryResolveSymbols = function _tryResolveSymbols() {
            var res = this._map ? resolveSymbolsFromMap(this._map, this._trace) : resolveSymbols(this.traceInfo.pid, this._trace);
            if (res.resolved) {
                this.emit("info", "Resolved symbols in trace.");
                this._trace = res.resolved;
                return
            }
            this.emit("warn", res.reason)
        };
        proto._resolveTraceInfo = function _resolveTraceInfo() {
            var converter = this._converterCtr(this._trace, this._traceStart, this._opts);
            converter._parseTraceInfo(this._trace[this._traceStart], true);
            this.traceInfo = {
                process: converter._process,
                pid: converter._pid,
                startTime: converter._startTime,
                type: converter._type
            };
            this.emit("info", "Trace info: %j", this.traceInfo)
        };
        proto._filterInternals = function _filterInternals() {
            this._filtered = this._trace;
            this._filtered = filterInternals(this._trace, this._opts);
            this._filteredLen = this._filtered.length;
            this.emit("info", "Filtered %d internals from given trace", this._traceLen - this._filteredLen)
        }
    }, {
        "./lib/get-converter": 21,
        "./lib/resolve-symbols": 23,
        "./lib/resolve-symbols-from-map": 22,
        "./lib/trace-util": 24,
        events: 10,
        inherits: 25,
        "trace-filter-internals": 39,
        xtend: 41
    }],
    16: [function(require, module, exports) {
        "use strict";
        var inherits = require("inherits"),
            Converter = require("./converter");

        function DTraceConverter(trace, traceStart, opts) {
            if (!(this instanceof DTraceConverter)) return new DTraceConverter(trace, traceStart, opts);
            Converter.call(this, trace, traceStart, opts);
            this._frameProcessRegex = new RegExp("^(" + this._process + "|node)`")
        }
        inherits(DTraceConverter, Converter);
        var proto = DTraceConverter.prototype;
        proto._framePartsRegex = /(.+?) (.+?):(\d+)$/;
        proto._parseFrame = function _parseFrame(frame) {
            var m = frame.match(this._framePartsRegex);
            if (!m) return {
                functionName: frame,
                url: "",
                lineNumber: 0,
                scriptId: 0
            };
            var functionName = m[1],
                script = m[2],
                lineNumber = m[3];
            var scriptId = this._scriptIds[script];
            if (!scriptId) {
                scriptId = this._scriptId++;
                this._scriptIds[script] = scriptId
            }
            if (/^[~*]\s*$/.test(functionName)) functionName += " <anonymous>";
            return {
                functionName: functionName,
                lineNumber: lineNumber,
                url: script,
                scriptId: scriptId
            }
        };

        function inspect(obj, depth) {
            console.error(require("util").inspect(obj, false, depth || 5, true))
        }
        proto._parseTraceInfo = function _parseTraceInfo(line, isStart) {
            var parts = line.split(" ");
            if (!isStart) {
                this._endTime = parts[2] && parts[2].slice(0, -1) || "0";
                return
            }
            if (this._startTime && this._process && this._pid && this._type) return;
            this._startTime = parts[2] && parts[2].slice(0, -1) || "0.0";
            this._process = parts[0];
            this._pid = parts[1];
            this._type = parts[3] || ""
        };
        proto._normalizeFrame = function _normalizeFrame(frame) {
            return frame.trim().replace(this._frameAddressRegex, "").replace(this._frameProcessRegex, "").replace(this._frameJSAddressRegex, "")
        };
        proto._adjustTime = function _adjustTime(t) {
            var s = t.toString();
            if (s.length < 5) return s;
            return s.slice(0, -3) + "." + s.slice(4)
        };
        proto._frameAddressRegex = /\+0x[0-9a-fA-F]+$/;
        proto._frameJSAddressRegex = /0x[0-9a-fA-F]+( LazyCompile:| Function:){0,1}/;
        proto.type = "dtrace";
        exports = module.exports = DTraceConverter;
        exports.ctor = DTraceConverter;
        exports.proto = proto
    }, {
        "./converter": 19,
        inherits: 25,
        util: 14
    }],
    17: [function(require, module, exports) {
        "use strict";
        var cpuprofile = require("./cpuprofile"),
            traceUtil = require("./trace-util"),
            Converter = require("./converter").proto,
            headerRegex = /^Running Time, *Self,.*, *Symbol Name/;

        function InstrumentsConverter(trace, traceStart, opts) {
            if (!(this instanceof InstrumentsConverter)) return new InstrumentsConverter(trace, traceStart, opts);
            this._trace = traceUtil.normalizeEmptyLines(trace);
            this._traceStart = traceStart;
            if (headerRegex.test(this._trace[this._traceStart])) this._traceStart++;
            this._scriptId = 0;
            this._scriptIds = {};
            this._samples = [];
            this._stack = [];
            this._id = 0;
            this._process = "unknown";
            this._pid = 0;
            this._startTime = 0;
            this._type = "instruments";
            this._samples = [];
            this._head = cpuprofile.createHead(this._process, this._id++)
        }
        var proto = InstrumentsConverter.prototype;
        proto._regex = /(\d+)\.\d+ms[^,]+,\d+,\s+,(\s*)(.+)/;
        proto.findOrCreateNode = function findOrCreateNode(parent, nextId, stackFrame) {
            var child;
            for (var i = 0; i < parent.children.length; i++) {
                child = parent.children[i];
                if (child._stackFrame === stackFrame) {
                    return child
                }
            }
            var node = cpuprofile.createNode(nextId, stackFrame, {
                functionName: stackFrame
            });
            parent.children.push(node);
            return node
        };
        proto._parseTraceInfo = function _parseTraceInfo() {};
        proto._processLine = function _processLine(line) {
            var parent = this._head,
                stackFrame;
            var matches = line.match(this._regex);
            if (!matches || !matches.length) return;
            var ms = matches[1];
            var depth = matches[2].length;
            var fn = matches[3];
            this._stack[depth] = fn;
            for (var i = 0; i < depth; i++) {
                stackFrame = this._stack[i];
                if (stackFrame) {
                    parent = this.findOrCreateNode(parent, this._id, this._stack[i]);
                    this._id = Math.max(parent.id + 1, this._id)
                }
            }
            parent.hitCount = parseInt(ms);
            for (var j = 0; j < ms; j++) this._samples.push(parent.id)
        };
        proto.objectifyTrace = function objectifyTrace() {
            for (var i = this._traceStart; i < this._trace.length; i++) this._processLine(this._trace[i]);
            return this
        };
        proto.convert = function convert() {
            return this.objectifyTrace().cpuprofile()
        };
        proto.cpuprofile = function cpuprofile() {
            return {
                typeId: "CPU " + this._type,
                uid: 1,
                title: this._process + " - " + this._type,
                head: this._head,
                startTime: this._startTime,
                endTime: 5,
                samples: this._samples
            }
        };
        proto.type = "instruments";
        exports = module.exports = InstrumentsConverter;
        exports.ctor = InstrumentsConverter;
        exports.proto = proto
    }, {
        "./converter": 19,
        "./cpuprofile": 20,
        "./trace-util": 24
    }],
    18: [function(require, module, exports) {
        "use strict";
        var inherits = require("inherits"),
            Converter = require("./converter"),
            DTraceConverter = require("./converter-dtrace").proto;

        function PerfConverter(trace, traceStart, opts) {
            if (!(this instanceof PerfConverter)) return new PerfConverter(trace, traceStart, opts);
            Converter.call(this, trace, traceStart, opts)
        }
        inherits(PerfConverter, Converter);
        var proto = PerfConverter.prototype;
        proto._frameRegex = /^\w+\s+(?:LazyCompile:|Function:){0,1}(.+?)\W\(\S+\)$/;
        proto._framePartsRegex = /^(.+?)([\S\.]+):(\d+)$/;
        proto._parseFrame = function _parseFrame(frame) {
            return DTraceConverter._parseFrame.call(this, frame)
        };
        proto._parseTraceInfo = function _parseTraceInfo(line, isStart) {
            DTraceConverter._parseTraceInfo.call(this, line, isStart)
        };
        proto._normalizeFrame = function _normalizeFrame(frame) {
            return frame.trim().replace(this._frameRegex, "$1")
        };
        proto._adjustTime = function _adjustTime(t) {
            return parseInt(t.toString().slice(0, -4))
        };
        proto.type = "perf";
        exports = module.exports = PerfConverter;
        exports.ctor = PerfConverter;
        exports.proto = proto
    }, {
        "./converter": 19,
        "./converter-dtrace": 16,
        inherits: 25
    }],
    19: [function(require, module, exports) {
        "use strict";
        var cpuprofile = require("./cpuprofile"),
            traceUtil = require("./trace-util");

        function Converter(trace, traceStart, opts) {
            if (!(this instanceof Converter)) return new Converter(trace, traceStart, opts);
            opts = opts || {};
            this._trace = traceUtil.normalizeEmptyLines(trace);
            this._traceStart = traceStart;
            this._id = 0;
            this._scriptId = 0;
            this._scriptIds = {};
            this._process = undefined;
            this._pid = undefined;
            this._type = undefined;
            this._startTime = undefined;
            this._endTime = undefined;
            this._parseTraceInfo(trace[this._traceStart], true);
            this._head = cpuprofile.createHead(this._process, this._scriptId++);
            this._samples = [];
            this._shortStacks = opts.shortStacks
        }
        var proto = Converter.prototype;
        proto._parseFrame = function _parseFrame(frame) {
            throw new Error("Need to implement _parseFrame.")
        };
        proto._parseTraceInfo = function _parseTraceInfo(frame) {
            throw new Error("Need to implement _parseTraceInfo.")
        };
        proto._normalizeFrame = function _normalizeFrame(frame) {
            throw new Error("Need to implement _normalizeFrame.")
        };
        proto._adjustTime = function _adjustTime(frame) {
            throw new Error("Need to implement _adjustTime.")
        };
        proto.findOrCreateNode = function findOrCreateNode(parent, nextId, stackFrame) {
            var child;
            for (var i = 0; i < parent.children.length; i++) {
                child = parent.children[i];
                if (child._stackFrame === stackFrame) {
                    return child
                }
            }
            var opts = this._parseFrame(stackFrame);
            var node = cpuprofile.createNode(nextId, stackFrame, opts);
            parent.children.push(node);
            return node
        };
        proto.objectifyStack = function objectifyStack(stackStart, stackEnd) {
            var parent = this._head,
                frame;
            for (var i = stackEnd; i >= stackStart; i--) {
                frame = this._normalizeFrame(this._trace[i]);
                if (!frame.length) continue;
                parent = this.findOrCreateNode(parent, this._id, frame);
                this._id = Math.max(parent.id + 1, this._id)
            }
            parent.hitCount++;
            this._samples.push(parent.id)
        };
        proto.objectifyTrace = function objectifyTrace() {
            var stackStart = 0,
                insideStack = false,
                line, nextLine, nextNextLine, lastTraceInfo;
            for (var i = this._traceStart; i < this._trace.length; i++) {
                line = this._trace[i];
                if (!insideStack && line.length && line.charAt(0) !== " ") {
                    nextLine = this._trace[i + 1];
                    if (!nextLine || !nextLine.length) continue;
                    if (!this._shortStacks) {
                        nextNextLine = this._trace[i + 2];
                        if (!nextNextLine || !nextNextLine.length) continue
                    }
                    lastTraceInfo = line;
                    stackStart = i + 1;
                    insideStack = true
                }
                if (insideStack && !line.length) {
                    this.objectifyStack(stackStart, i - 1);
                    insideStack = false
                }
            }
            this._parseTraceInfo(lastTraceInfo, false);
            return this
        };
        proto.cpuprofile = function cpuprofile() {
            return {
                typeId: "CPU " + this._type,
                uid: 1,
                title: this._process + " - " + this._type,
                head: this._head,
                startTime: this._adjustTime(this._startTime),
                endTime: this._adjustTime(this._endTime),
                samples: this._samples
            }
        };
        proto.convert = function convert() {
            return this.objectifyTrace().cpuprofile()
        };
        exports = module.exports = Converter;
        exports.ctor = Converter;
        exports.proto = proto
    }, {
        "./cpuprofile": 20,
        "./trace-util": 24
    }],
    20: [function(require, module, exports) {
        "use strict";
        exports.createHead = function createHead(execname, id) {
            return {
                functionName: execname,
                url: "",
                lineNumber: 0,
                callUiD: 0,
                bailoutReason: "",
                id: id,
                scriptId: 0,
                hitCount: 0,
                children: []
            }
        };
        exports.createNode = function createNode(id, stackFrame, opts) {
            return {
                functionName: opts.functionName,
                url: opts.url || "",
                lineNumber: opts.lineNumber || 0,
                bailoutReason: opts.bailoutReason || "",
                id: id,
                scriptId: opts.scriptId || 0,
                hitCount: 0,
                children: [],
                _stackFrame: stackFrame
            }
        }
    }, {}],
    21: [function(require, module, exports) {
        "use strict";
        var dtraceConverterCtr = require("./converter-dtrace"),
            perfConverterCtr = require("./converter-perf"),
            instrumentsConverterCtr = require("./converter-instruments");
        var dtraceRegex = /^\S+ \d+ \d+: \S+:\s*$/,
            perfRegex = /^\S+ \d+ \d+\.\d+: \S+:\s*$/,
            instrumentsRegex = /^Running Time, *Self,.*, *Symbol Name/;
        var go = module.exports = function getConverter(trace, traceStart, type) {
            if (type) {
                switch (type) {
                    case "perf":
                        return perfConverterCtr;
                    case "dtrace":
                        return dtraceConverterCtr;
                    case "instruments":
                        return instrumentsConverterCtr;
                    default:
                        throw new Error("Unknown input type : " + type)
                }
            }
            var line = trace[traceStart];
            if (dtraceRegex.test(line)) return dtraceConverterCtr;
            if (perfRegex.test(line)) return perfConverterCtr;
            if (instrumentsRegex.test(line)) return instrumentsConverterCtr;
            throw new Error('Unable to detect input type for \n"' + line + '"')
        }
    }, {
        "./converter-dtrace": 16,
        "./converter-instruments": 17,
        "./converter-perf": 18
    }],
    22: [function(require, module, exports) {
        "use strict";
        var resolveJITSymbols = require("resolve-jit-symbols");
        module.exports = function resolveSymbolsFromMap(map, trace) {
            var resolver = resolveJITSymbols(map),
                resolved = resolver.resolveMulti(trace);
            return {
                resolved: resolved
            }
        }
    }, {
        "resolve-jit-symbols": 26
    }],
    23: [function(require, module, exports) {
        "use strict";
        module.exports = function resolveSymbols(pid, trace) {
            return trace
        }
    }, {}],
    24: [function(require, module, exports) {
        "use strict";
        exports.normalizeEmptyLines = function normalizeEmptyLines(trace) {
            var l = trace.length - 1;
            while (l > 0 && trace[l].trim() === "") l--;
            trace.length = l + 2;
            trace[l + 1] = "";
            return trace
        };
        exports.traceStart = function traceStart(lines) {
            for (var i = 0; i < lines.length; i++) {
                if (lines[i] && lines[i].length && lines[i][0] !== "#") return i
            }
        }
    }, {}],
    25: [function(require, module, exports) {
        module.exports = require(11)
    }, {
        "/Volumes/d/dev/js/projects/flamegraph/node_modules/browserify/node_modules/inherits/inherits_browser.js": 11
    }],
    26: [function(require, module, exports) {
        "use strict";
        var prettyTrace = require("pretty-trace");
        var instrumentsCsvRegex = prettyTrace.regexes.instruments.csv.regex;
        var hexAddressRegex = /0x([0-9A-Fa-f]{2,12})/,
            lldb_backtraceRegex = /(:?0x(?:(?:\d|[abcdefABCDEF]){0,2})+) +in +(:?0x(?:(?:\d|[abcdefABCDEF]){0,2})+)/;

        function byDecimalAddress(a, b) {
            return a.decimalAddress < b.decimalAddress ? -1 : 1
        }

        function processLine(acc, x) {
            if (!x.trim().length) return acc;
            var parts = x.split(/ +/);
            if (parts.length < 3) return acc;
            var decimal = parseInt(parts[0], 16);
            var item = {
                address: parts[0],
                size: parts[1],
                decimalAddress: decimal,
                symbol: parts.slice(2).join(" ")
            };
            acc.push(item);
            return acc
        }

        function JITResolver(map) {
            if (!(this instanceof JITResolver)) return new JITResolver(map);
            var lines = Array.isArray(map) ? map : map.split("\n");
            this._addresses = lines.reduce(processLine, []).sort(byDecimalAddress);
            this._len = this._addresses.length
        }
        module.exports = JITResolver;
        var proto = JITResolver.prototype;
        proto.resolve = function resolve(hexAddress) {
            var match = null;
            var a = typeof hexAddress === "number" ? hexAddress : parseInt(hexAddress, 16);
            for (var i = 0; i < this._len; i++) {
                if (a < this._addresses[i].decimalAddress) {
                    match = this._addresses[i - 1];
                    break
                }
            }
            return match
        };

        function defaultGetHexAddress(line) {
            var m = line.match(hexAddressRegex);
            if (!m) return null;
            var matchStackTrace = line.match(lldb_backtraceRegex);
            var res;
            if (matchStackTrace) {
                return {
                    address: matchStackTrace[2],
                    include: false
                }
            }
            var include = !instrumentsCsvRegex.test(line);
            return m && {
                address: m[0],
                include: include
            }
        }
        proto.resolveMulti = function resolveMulti(stack, getHexAddress) {
            getHexAddress = getHexAddress || defaultGetHexAddress;
            var self = this;
            var isLines = Array.isArray(stack);
            var lines = isLines ? stack : stack.split("\n");

            function processLine(line) {
                var replacement;
                var match = getHexAddress(line);
                if (!match || !match.address) return line;
                var resolved = self.resolve(match.address);
                if (!resolved) return line;
                return line.replace(match.address, match.include ? match.address + " " + resolved.symbol : resolved.symbol)
            }
            var processedLines = lines.map(processLine);
            return isLines ? processedLines : processedLines.join("\n")
        };
        proto.hexAddressRegex = hexAddressRegex;
        proto.lldb_backtraceRegex = lldb_backtraceRegex
    }, {
        "pretty-trace": 28
    }],
    27: [function(require, module, exports) {
        "use strict";
        var colorNums = {
                white: 37,
                black: 30,
                blue: 34,
                cyan: 36,
                green: 32,
                magenta: 35,
                red: 31,
                yellow: 33,
                brightBlack: 90,
                brightRed: 91,
                brightGreen: 92,
                brightYellow: 93,
                brightBlue: 94,
                brightMagenta: 95,
                brightCyan: 96,
                brightWhite: 97
            },
            backgroundColorNums = {
                bgBlack: 40,
                bgRed: 41,
                bgGreen: 42,
                bgYellow: 43,
                bgBlue: 44,
                bgMagenta: 45,
                bgCyan: 46,
                bgWhite: 47,
                bgBrightBlack: 100,
                bgBrightRed: 101,
                bgBrightGreen: 102,
                bgBrightYellow: 103,
                bgBrightBlue: 104,
                bgBrightMagenta: 105,
                bgBrightCyan: 106,
                bgBrightWhite: 107
            },
            colors = {};
        Object.keys(colorNums).forEach(function(k) {
            colors[k] = function(s) {
                return "[" + colorNums[k] + "m" + s + "[39m"
            }
        });
        Object.keys(backgroundColorNums).forEach(function(k) {
            colors[k] = function(s) {
                return "[" + backgroundColorNums[k] + "m" + s + "[49m"
            }
        });
        module.exports = colors
    }, {}],
    28: [function(require, module, exports) {
        "use strict";
        var colors = require("ansicolors");
        var lldb = {
            frameAddInSymAtLoc: {
                desc: "#num 0x0000 in symbol() at file.cc",
                regex: /^(:?#\d+\W+)(:?0x(?:(?:\d|[abcdefABCDEF]){0,2})+)(:? +in +)(:?.+?)(:? +at +)(:?.+)$/m,
                matches: ["frame", "address", "in", "symbol", "at", "file"]
            },
            frameAddInSymLoc: {
                desc: "#num 0x000 in symbol() file.js",
                regex: /^(:?#\d+\W+)(:?0x(?:(?:\d|[abcdefABCDEF]){0,2})+)(:? +in +)(:?.+?)(:? .+)$/m,
                matches: ["frame", "address", "in", "symbol", "file"]
            },
            frameAddSymAtLoc: {
                desc: "frame #x 0x0000 symbol(..) at file.c:100 OR frame #x: 0x0000",
                regex: /^(:?[^#]*?#\d+[:]{0,1}\W+)(:?0x(?:(?:\d|[abcdefABCDEF]){0,2})+)(:?.*?)(?:(:?\W+at\W+)(:?[^:]+:\d.+)){0,1}$/m,
                matches: ["frame", "address", "symbol", "at", "file"]
            },
            frameSymLoc: {
                desc: "frame #x LazyCompile:~symbol(..) file.js:100",
                regex: /^(:?[^#]*?#\d+[:]{0,1}\W+)(:?[^\/ ]+)(:?.+){0,1}$/m,
                matches: ["frame", "symbol", "file"]
            }
        };
        var instruments = {
            csv: {
                desc: "XX.Xms XX.X%,,X , address OR symbol",
                regex: /^(:?[0-9.]+)(:?ms|s)(:?\W+[0-9.]+%),\d+,\W+,(:?\W+0x(?:(?:\d|[abcdefABCDEF]){2})+){0,1}(:?.+?){0,1}$/m,
                matches: ["time", "timeUnit", "percent", "address", "symbol"]
            }
        };
        var perf = {
            script: {
                desc: "address symbol (process)",
                regex: /^(:?\W+(?:(?:\d|[abcdefABCDEF]){2})+){0,1}\W+(:?.+?){1}(:?\([^()]+\)){0,1}$/m,
                matches: ["address", "symbol", "process"]
            }
        };
        exports.line = function prettyLine(line, theme) {
            var pat;
            if (!line) throw new Error("Please supply a line");
            if (!theme) throw new Error("Please supply a theme");
            pat = lldb.frameAddInSymAtLoc;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, frame, address, in_, symbol, at_, location) {
                    return theme.frame(frame) + theme.address(address) + in_ + theme.symbol(symbol) + at_ + theme.location(location)
                })
            }
            pat = lldb.frameAddInSymLoc;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, frame, address, in_, symbol, location) {
                    return theme.frame(frame) + theme.address(address) + in_ + theme.symbol(symbol) + theme.location(location)
                })
            }
            pat = lldb.frameAddSymAtLoc;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, frame, address, symbol, at_, location) {
                    return theme.frame(frame) + theme.address(address) + theme.symbol(symbol || "") + (at_ || "") + theme.location(location || "")
                })
            }
            pat = lldb.frameSymLoc;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, frame, symbol, location) {
                    return theme.frame(frame) + theme.symbol(symbol || "") + theme.location(location || "")
                })
            }
            pat = instruments.csv;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, time, timeUnit, percent, address, symbol) {
                    return theme.frame(time) + " " + timeUnit + theme.location(percent) + " " + (address ? theme.address(address) : "") + (symbol ? theme.symbol(symbol) : "")
                })
            }
            pat = perf.script;
            if (pat.regex.test(line)) {
                return line.replace(pat.regex, function(match, address, symbol, process) {
                    return theme.address(address) + " " + theme.symbol(symbol) + " " + theme.location(process)
                })
            }
            return theme.raw(line)
        };
        exports.lines = function prettyLines(lines, theme) {
            if (!lines || !Array.isArray(lines)) throw new Error("Please supply an array of lines");
            if (!theme) throw new Error("Please supply a theme");

            function prettify(line) {
                if (!line) return null;
                return exports.line(line, theme)
            }
            return lines.map(prettify)
        };
        exports.terminalTheme = {
            raw: colors.white,
            frame: colors.brightGreen,
            address: colors.brightBlack,
            symbol: colors.brightBlue,
            location: colors.brightBlack
        };

        function spanClass(clazz, link) {
            return function span(x) {
                if (!x) return "";
                if (link) {
                    x = '<a href="file://' + x.split(":")[0] + '">' + x + "</a>"
                }
                return '<span class="' + clazz + '">' + x + "</span>"
            }
        }
        exports.htmlTheme = {
            raw: spanClass("trace-raw"),
            frame: spanClass("trace-frame"),
            address: spanClass("trace-address"),
            symbol: spanClass("trace-symbol"),
            location: spanClass("trace-location", true)
        };
        exports.regexes = {
            lldb: lldb,
            perf: perf,
            instruments: instruments
        }
    }, {
        ansicolors: 27
    }],
    29: [function(require, module, exports) {
        var now = require("date-now");
        module.exports = function debounce(func, wait, immediate) {
            var timeout, args, context, timestamp, result;
            if (null == wait) wait = 100;

            function later() {
                var last = now() - timestamp;
                if (last < wait && last > 0) {
                    timeout = setTimeout(later, wait - last)
                } else {
                    timeout = null;
                    if (!immediate) {
                        result = func.apply(context, args);
                        if (!timeout) context = args = null
                    }
                }
            }
            return function debounced() {
                context = this;
                args = arguments;
                timestamp = now();
                var callNow = immediate && !timeout;
                if (!timeout) timeout = setTimeout(later, wait);
                if (callNow) {
                    result = func.apply(context, args);
                    context = args = null
                }
                return result
            }
        }
    }, {
        "date-now": 30
    }],
    30: [function(require, module, exports) {
        module.exports = Date.now || now;

        function now() {
            return (new Date).getTime()
        }
    }, {}],
    31: [function(require, module, exports) {
        "use strict";
        var base = require("./handlebars/base");
        var SafeString = require("./handlebars/safe-string")["default"];
        var Exception = require("./handlebars/exception")["default"];
        var Utils = require("./handlebars/utils");
        var runtime = require("./handlebars/runtime");
        var create = function() {
            var hb = new base.HandlebarsEnvironment;
            Utils.extend(hb, base);
            hb.SafeString = SafeString;
            hb.Exception = Exception;
            hb.Utils = Utils;
            hb.escapeExpression = Utils.escapeExpression;
            hb.VM = runtime;
            hb.template = function(spec) {
                return runtime.template(spec, hb)
            };
            return hb
        };
        var Handlebars = create();
        Handlebars.create = create;
        Handlebars["default"] = Handlebars;
        exports["default"] = Handlebars
    }, {
        "./handlebars/base": 32,
        "./handlebars/exception": 33,
        "./handlebars/runtime": 34,
        "./handlebars/safe-string": 35,
        "./handlebars/utils": 36
    }],
    32: [function(require, module, exports) {
        "use strict";
        var Utils = require("./utils");
        var Exception = require("./exception")["default"];
        var VERSION = "2.0.0";
        exports.VERSION = VERSION;
        var COMPILER_REVISION = 6;
        exports.COMPILER_REVISION = COMPILER_REVISION;
        var REVISION_CHANGES = {
            1: "<= 1.0.rc.2",
            2: "== 1.0.0-rc.3",
            3: "== 1.0.0-rc.4",
            4: "== 1.x.x",
            5: "== 2.0.0-alpha.x",
            6: ">= 2.0.0-beta.1"
        };
        exports.REVISION_CHANGES = REVISION_CHANGES;
        var isArray = Utils.isArray,
            isFunction = Utils.isFunction,
            toString = Utils.toString,
            objectType = "[object Object]";

        function HandlebarsEnvironment(helpers, partials) {
            this.helpers = helpers || {};
            this.partials = partials || {};
            registerDefaultHelpers(this)
        }
        exports.HandlebarsEnvironment = HandlebarsEnvironment;
        HandlebarsEnvironment.prototype = {
            constructor: HandlebarsEnvironment,
            logger: logger,
            log: log,
            registerHelper: function(name, fn) {
                if (toString.call(name) === objectType) {
                    if (fn) {
                        throw new Exception("Arg not supported with multiple helpers")
                    }
                    Utils.extend(this.helpers, name)
                } else {
                    this.helpers[name] = fn
                }
            },
            unregisterHelper: function(name) {
                delete this.helpers[name]
            },
            registerPartial: function(name, partial) {
                if (toString.call(name) === objectType) {
                    Utils.extend(this.partials, name)
                } else {
                    this.partials[name] = partial
                }
            },
            unregisterPartial: function(name) {
                delete this.partials[name]
            }
        };

        function registerDefaultHelpers(instance) {
            instance.registerHelper("helperMissing", function() {
                if (arguments.length === 1) {
                    return undefined
                } else {
                    throw new Exception("Missing helper: '" + arguments[arguments.length - 1].name + "'")
                }
            });
            instance.registerHelper("blockHelperMissing", function(context, options) {
                var inverse = options.inverse,
                    fn = options.fn;
                if (context === true) {
                    return fn(this)
                } else if (context === false || context == null) {
                    return inverse(this)
                } else if (isArray(context)) {
                    if (context.length > 0) {
                        if (options.ids) {
                            options.ids = [options.name]
                        }
                        return instance.helpers.each(context, options)
                    } else {
                        return inverse(this)
                    }
                } else {
                    if (options.data && options.ids) {
                        var data = createFrame(options.data);
                        data.contextPath = Utils.appendContextPath(options.data.contextPath, options.name);
                        options = {
                            data: data
                        }
                    }
                    return fn(context, options)
                }
            });
            instance.registerHelper("each", function(context, options) {
                if (!options) {
                    throw new Exception("Must pass iterator to #each")
                }
                var fn = options.fn,
                    inverse = options.inverse;
                var i = 0,
                    ret = "",
                    data;
                var contextPath;
                if (options.data && options.ids) {
                    contextPath = Utils.appendContextPath(options.data.contextPath, options.ids[0]) + "."
                }
                if (isFunction(context)) {
                    context = context.call(this)
                }
                if (options.data) {
                    data = createFrame(options.data)
                }
                if (context && typeof context === "object") {
                    if (isArray(context)) {
                        for (var j = context.length; i < j; i++) {
                            if (data) {
                                data.index = i;
                                data.first = i === 0;
                                data.last = i === context.length - 1;
                                if (contextPath) {
                                    data.contextPath = contextPath + i
                                }
                            }
                            ret = ret + fn(context[i], {
                                data: data
                            })
                        }
                    } else {
                        for (var key in context) {
                            if (context.hasOwnProperty(key)) {
                                if (data) {
                                    data.key = key;
                                    data.index = i;
                                    data.first = i === 0;
                                    if (contextPath) {
                                        data.contextPath = contextPath + key
                                    }
                                }
                                ret = ret + fn(context[key], {
                                    data: data
                                });
                                i++
                            }
                        }
                    }
                }
                if (i === 0) {
                    ret = inverse(this)
                }
                return ret
            });
            instance.registerHelper("if", function(conditional, options) {
                if (isFunction(conditional)) {
                    conditional = conditional.call(this)
                }
                if (!options.hash.includeZero && !conditional || Utils.isEmpty(conditional)) {
                    return options.inverse(this)
                } else {
                    return options.fn(this)
                }
            });
            instance.registerHelper("unless", function(conditional, options) {
                return instance.helpers["if"].call(this, conditional, {
                    fn: options.inverse,
                    inverse: options.fn,
                    hash: options.hash
                })
            });
            instance.registerHelper("with", function(context, options) {
                if (isFunction(context)) {
                    context = context.call(this)
                }
                var fn = options.fn;
                if (!Utils.isEmpty(context)) {
                    if (options.data && options.ids) {
                        var data = createFrame(options.data);
                        data.contextPath = Utils.appendContextPath(options.data.contextPath, options.ids[0]);
                        options = {
                            data: data
                        }
                    }
                    return fn(context, options)
                } else {
                    return options.inverse(this)
                }
            });
            instance.registerHelper("log", function(message, options) {
                var level = options.data && options.data.level != null ? parseInt(options.data.level, 10) : 1;
                instance.log(level, message)
            });
            instance.registerHelper("lookup", function(obj, field) {
                return obj && obj[field]
            })
        }
        var logger = {
            methodMap: {
                0: "debug",
                1: "info",
                2: "warn",
                3: "error"
            },
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3,
            level: 3,
            log: function(level, message) {
                if (logger.level <= level) {
                    var method = logger.methodMap[level];
                    if (typeof console !== "undefined" && console[method]) {
                        console[method].call(console, message)
                    }
                }
            }
        };
        exports.logger = logger;
        var log = logger.log;
        exports.log = log;
        var createFrame = function(object) {
            var frame = Utils.extend({}, object);
            frame._parent = object;
            return frame
        };
        exports.createFrame = createFrame
    }, {
        "./exception": 33,
        "./utils": 36
    }],
    33: [function(require, module, exports) {
        "use strict";
        var errorProps = ["description", "fileName", "lineNumber", "message", "name", "number", "stack"];

        function Exception(message, node) {
            var line;
            if (node && node.firstLine) {
                line = node.firstLine;
                message += " - " + line + ":" + node.firstColumn
            }
            var tmp = Error.prototype.constructor.call(this, message);
            for (var idx = 0; idx < errorProps.length; idx++) {
                this[errorProps[idx]] = tmp[errorProps[idx]]
            }
            if (line) {
                this.lineNumber = line;
                this.column = node.firstColumn
            }
        }
        Exception.prototype = new Error;
        exports["default"] = Exception
    }, {}],
    34: [function(require, module, exports) {
        "use strict";
        var Utils = require("./utils");
        var Exception = require("./exception")["default"];
        var COMPILER_REVISION = require("./base").COMPILER_REVISION;
        var REVISION_CHANGES = require("./base").REVISION_CHANGES;
        var createFrame = require("./base").createFrame;

        function checkRevision(compilerInfo) {
            var compilerRevision = compilerInfo && compilerInfo[0] || 1,
                currentRevision = COMPILER_REVISION;
            if (compilerRevision !== currentRevision) {
                if (compilerRevision < currentRevision) {
                    var runtimeVersions = REVISION_CHANGES[currentRevision],
                        compilerVersions = REVISION_CHANGES[compilerRevision];
                    throw new Exception("Template was precompiled with an older version of Handlebars than the current runtime. " + "Please update your precompiler to a newer version (" + runtimeVersions + ") or downgrade your runtime to an older version (" + compilerVersions + ").")
                } else {
                    throw new Exception("Template was precompiled with a newer version of Handlebars than the current runtime. " + "Please update your runtime to a newer version (" + compilerInfo[1] + ").")
                }
            }
        }
        exports.checkRevision = checkRevision;

        function template(templateSpec, env) {
            if (!env) {
                throw new Exception("No environment passed to template")
            }
            if (!templateSpec || !templateSpec.main) {
                throw new Exception("Unknown template object: " + typeof templateSpec)
            }
            env.VM.checkRevision(templateSpec.compiler);
            var invokePartialWrapper = function(partial, indent, name, context, hash, helpers, partials, data, depths) {
                if (hash) {
                    context = Utils.extend({}, context, hash)
                }
                var result = env.VM.invokePartial.call(this, partial, name, context, helpers, partials, data, depths);
                if (result == null && env.compile) {
                    var options = {
                        helpers: helpers,
                        partials: partials,
                        data: data,
                        depths: depths
                    };
                    partials[name] = env.compile(partial, {
                        data: data !== undefined,
                        compat: templateSpec.compat
                    }, env);
                    result = partials[name](context, options)
                }
                if (result != null) {
                    if (indent) {
                        var lines = result.split("\n");
                        for (var i = 0, l = lines.length; i < l; i++) {
                            if (!lines[i] && i + 1 === l) {
                                break
                            }
                            lines[i] = indent + lines[i]
                        }
                        result = lines.join("\n")
                    }
                    return result
                } else {
                    throw new Exception("The partial " + name + " could not be compiled when running in runtime-only mode")
                }
            };
            var container = {
                lookup: function(depths, name) {
                    var len = depths.length;
                    for (var i = 0; i < len; i++) {
                        if (depths[i] && depths[i][name] != null) {
                            return depths[i][name]
                        }
                    }
                },
                lambda: function(current, context) {
                    return typeof current === "function" ? current.call(context) : current
                },
                escapeExpression: Utils.escapeExpression,
                invokePartial: invokePartialWrapper,
                fn: function(i) {
                    return templateSpec[i]
                },
                programs: [],
                program: function(i, data, depths) {
                    var programWrapper = this.programs[i],
                        fn = this.fn(i);
                    if (data || depths) {
                        programWrapper = program(this, i, fn, data, depths)
                    } else if (!programWrapper) {
                        programWrapper = this.programs[i] = program(this, i, fn)
                    }
                    return programWrapper
                },
                data: function(data, depth) {
                    while (data && depth--) {
                        data = data._parent
                    }
                    return data
                },
                merge: function(param, common) {
                    var ret = param || common;
                    if (param && common && param !== common) {
                        ret = Utils.extend({}, common, param)
                    }
                    return ret
                },
                noop: env.VM.noop,
                compilerInfo: templateSpec.compiler
            };
            var ret = function(context, options) {
                options = options || {};
                var data = options.data;
                ret._setup(options);
                if (!options.partial && templateSpec.useData) {
                    data = initData(context, data)
                }
                var depths;
                if (templateSpec.useDepths) {
                    depths = options.depths ? [context].concat(options.depths) : [context]
                }
                return templateSpec.main.call(container, context, container.helpers, container.partials, data, depths)
            };
            ret.isTop = true;
            ret._setup = function(options) {
                if (!options.partial) {
                    container.helpers = container.merge(options.helpers, env.helpers);
                    if (templateSpec.usePartial) {
                        container.partials = container.merge(options.partials, env.partials)
                    }
                } else {
                    container.helpers = options.helpers;
                    container.partials = options.partials
                }
            };
            ret._child = function(i, data, depths) {
                if (templateSpec.useDepths && !depths) {
                    throw new Exception("must pass parent depths")
                }
                return program(container, i, templateSpec[i], data, depths)
            };
            return ret
        }
        exports.template = template;

        function program(container, i, fn, data, depths) {
            var prog = function(context, options) {
                options = options || {};
                return fn.call(container, context, container.helpers, container.partials, options.data || data, depths && [context].concat(depths))
            };
            prog.program = i;
            prog.depth = depths ? depths.length : 0;
            return prog
        }
        exports.program = program;

        function invokePartial(partial, name, context, helpers, partials, data, depths) {
            var options = {
                partial: true,
                helpers: helpers,
                partials: partials,
                data: data,
                depths: depths
            };
            if (partial === undefined) {
                throw new Exception("The partial " + name + " could not be found")
            } else if (partial instanceof Function) {
                return partial(context, options)
            }
        }
        exports.invokePartial = invokePartial;

        function noop() {
            return ""
        }
        exports.noop = noop;

        function initData(context, data) {
            if (!data || !("root" in data)) {
                data = data ? createFrame(data) : {};
                data.root = context
            }
            return data
        }
    }, {
        "./base": 32,
        "./exception": 33,
        "./utils": 36
    }],
    35: [function(require, module, exports) {
        "use strict";

        function SafeString(string) {
            this.string = string
        }
        SafeString.prototype.toString = function() {
            return "" + this.string
        };
        exports["default"] = SafeString
    }, {}],
    36: [function(require, module, exports) {
        "use strict";
        var SafeString = require("./safe-string")["default"];
        var escape = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#x27;",
            "`": "&#x60;"
        };
        var badChars = /[&<>"'`]/g;
        var possible = /[&<>"'`]/;

        function escapeChar(chr) {
            return escape[chr]
        }

        function extend(obj) {
            for (var i = 1; i < arguments.length; i++) {
                for (var key in arguments[i]) {
                    if (Object.prototype.hasOwnProperty.call(arguments[i], key)) {
                        obj[key] = arguments[i][key]
                    }
                }
            }
            return obj
        }
        exports.extend = extend;
        var toString = Object.prototype.toString;
        exports.toString = toString;
        var isFunction = function(value) {
            return typeof value === "function"
        };
        if (isFunction(/x/)) {
            isFunction = function(value) {
                return typeof value === "function" && toString.call(value) === "[object Function]"
            }
        }
        var isFunction;
        exports.isFunction = isFunction;
        var isArray = Array.isArray || function(value) {
            return value && typeof value === "object" ? toString.call(value) === "[object Array]" : false
        };
        exports.isArray = isArray;

        function escapeExpression(string) {
            if (string instanceof SafeString) {
                return string.toString()
            } else if (string == null) {
                return ""
            } else if (!string) {
                return string + ""
            }
            string = "" + string;
            if (!possible.test(string)) {
                return string
            }
            return string.replace(badChars, escapeChar)
        }
        exports.escapeExpression = escapeExpression;

        function isEmpty(value) {
            if (!value && value !== 0) {
                return true
            } else if (isArray(value) && value.length === 0) {
                return true
            } else {
                return false
            }
        }
        exports.isEmpty = isEmpty;

        function appendContextPath(contextPath, id) {
            return (contextPath ? contextPath + "." : "") + id
        }
        exports.appendContextPath = appendContextPath
    }, {
        "./safe-string": 35
    }],
    37: [function(require, module, exports) {
        module.exports = require("./dist/cjs/handlebars.runtime")
    }, {
        "./dist/cjs/handlebars.runtime": 31
    }],
    38: [function(require, module, exports) {
        module.exports = require("handlebars/runtime")["default"]
    }, {
        "handlebars/runtime": 37
    }],
    39: [function(require, module, exports) {
        "use strict";
        var v8internalsRegex = new RegExp("node::Start\\(|node`(?:start\\+)?0x[0-9A-Fa-f]+" + "|v8::internal::|v8::Function::Call|v8::Function::NewInstance" + "|Builtin:|Stub:|StoreIC:|LoadIC:|LoadPolymorphicIC:|KeyedLoadIC:" + "|<Unknown Address>|_platform_\\w+\\$VARIANT\\$|DYLD-STUB\\$|_os_lock_spin_lock" + "|\\(root");
        var sysinternalsRegex = /^\W+dyld|__libc_start/;
        var unresolvedsRegex = /^\W*0x[0-9A-Fa-f]+\W*$/;
        var v8gcRegex = /v8::internal::Heap::Scavenge/;
        module.exports = function filterInternals(lines, opts) {
            opts = opts || {};
            var unresolveds = opts.unresolveds,
                sysinternals = opts.sysinternals,
                v8internals = opts.v8internals,
                v8gc = opts.v8gc;

            function notInternal(l) {
                if (v8gc && v8gcRegex.test(l)) return true;
                return (unresolveds || !unresolvedsRegex.test(l)) && (sysinternals || !sysinternalsRegex.test(l)) && (v8internals || !v8internalsRegex.test(l))
            }
            return lines.filter(notInternal)
        }
    }, {}],
    40: [function(require, module, exports) {
        (function(factory) {
            if (typeof define === "function" && define.amd) {
                define([], factory())
            } else if (typeof exports === "object") {
                module.exports = factory()
            } else {
                window.wheel = factory()
            }
        })(function() {
            var prefix = "",
                _addEventListener, _removeEventListener, onwheel, support, fns = [];
            if (window.addEventListener) {
                _addEventListener = "addEventListener";
                _removeEventListener = "removeEventListener"
            } else {
                _addEventListener = "attachEvent";
                _removeEventListener = "detachEvent";
                prefix = "on"
            }
            support = "onwheel" in document.createElement("div") ? "wheel" : document.onmousewheel !== undefined ? "mousewheel" : "DOMMouseScroll";

            function createCallback(element, callback, capture) {
                var fn = function(originalEvent) {
                    !originalEvent && (originalEvent = window.event);
                    var event = {
                        originalEvent: originalEvent,
                        target: originalEvent.target || originalEvent.srcElement,
                        type: "wheel",
                        deltaMode: originalEvent.type == "MozMousePixelScroll" ? 0 : 1,
                        deltaX: 0,
                        delatZ: 0,
                        preventDefault: function() {
                            originalEvent.preventDefault ? originalEvent.preventDefault() : originalEvent.returnValue = false
                        }
                    };
                    if (support == "mousewheel") {
                        event.deltaY = -1 / 40 * originalEvent.wheelDelta;
                        originalEvent.wheelDeltaX && (event.deltaX = -1 / 40 * originalEvent.wheelDeltaX)
                    } else {
                        event.deltaY = originalEvent.detail
                    }
                    return callback(event)
                };
                fns.push({
                    element: element,
                    fn: fn,
                    capture: capture
                });
                return fn
            }

            function getCallback(element, capture) {
                for (var i = 0; i < fns.length; i++) {
                    if (fns[i].element === element && fns[i].capture === capture) {
                        return fns[i].fn
                    }
                }
                return function() {}
            }

            function removeCallback(element, capture) {
                for (var i = 0; i < fns.length; i++) {
                    if (fns[i].element === element && fns[i].capture === capture) {
                        return fns.splice(i, 1)
                    }
                }
            }

            function _addWheelListener(elem, eventName, callback, useCapture) {
                var cb;
                if (support === "wheel") {
                    cb = callback
                } else {
                    cb = createCallback(elem, callback, useCapture)
                }
                elem[_addEventListener](prefix + eventName, cb, useCapture || false)
            }

            function _removeWheelListener(elem, eventName, callback, useCapture) {
                if (support === "wheel") {
                    cb = callback
                } else {
                    cb = getCallback(elem, useCapture)
                }
                elem[_removeEventListener](prefix + eventName, cb, useCapture || false);
                removeCallback(elem, useCapture)
            }

            function addWheelListener(elem, callback, useCapture) {
                _addWheelListener(elem, support, callback, useCapture);
                if (support == "DOMMouseScroll") {
                    _addWheelListener(elem, "MozMousePixelScroll", callback, useCapture)
                }
            }

            function removeWheelListener(elem, callback, useCapture) {
                _removeWheelListener(elem, support, callback, useCapture);
                if (support == "DOMMouseScroll") {
                    _removeWheelListener(elem, "MozMousePixelScroll", callback, useCapture)
                }
            }
            return {
                on: addWheelListener,
                off: removeWheelListener
            }
        })
    }, {}],
    41: [function(require, module, exports) {
        module.exports = extend;

        function extend() {
            var target = {};
            for (var i = 0; i < arguments.length; i++) {
                var source = arguments[i];
                for (var key in source) {
                    if (source.hasOwnProperty(key)) {
                        target[key] = source[key]
                    }
                }
            }
            return target
        }
    }, {}],
    42: [function(require, module, exports) {
        "use strict";
        var debounce = require("debounce");
        var searchFieldEl = document.querySelector(".search.ui-part input[type=search]"),
            regexCheckEl = document.getElementById("search-regex"),
            blinkCheckEl = document.getElementById("search-blink"),
            searchErrorEl = document.getElementById("search-error");

        function tryMakeRegex(query) {
            try {
                return new RegExp(query, "i")
            } catch (e) {
                console.error(e);
                searchErrorEl.value = e.message
            }
        }

        function addMatchIndicator(el) {
            el.classList.add("match");
            var rect = el.children[1];
            var w = rect.getAttribute("width");
            var h = rect.getAttribute("height");
            if (w < 10) {
                rect.setAttribute("width", 10)
            }
        }

        function removeMatchIndicator(el) {
            el.classList.remove("match");
            var rect = el.children[1];
            rect.setAttribute("width", parseInt(rect.getAttribute('width')));
            rect.setAttribute("height", parseInt(rect.getAttribute('height')))
        }

        function addBlink(el) {
            el.classList.add("blink")
        }

        function removeBlink(el) {
            el.classList.remove("blink")
        }

        function clearMatches() {
            var matches = document.querySelectorAll("g.func_g.match");
            for (var i = 0; i < matches.length; i++) {
                removeMatchIndicator(matches.item(i))
            }
        }

        function clearBlinks() {
            var matches = document.querySelectorAll("g.func_g.blink");
            for (var i = 0; i < matches.length; i++) {
                removeBlink(matches.item(i))
            }
        }

        function clearError() {
            searchErrorEl.value = ""
        }

        function indicateMatch(el, blink) {
            addMatchIndicator(el);
            if (blink) addBlink(el)
        }

        function onQueryChange() {
            clearMatches();
            clearBlinks();
            clearError();
            var query = searchFieldEl.value.trim();
            var isregex = regexCheckEl.checked;
            var blink = blinkCheckEl.checked;
            if (!query.length) return;
            var regex;
            if (isregex) {
                regex = tryMakeRegex(query);
                if (!regex) return
            } else {
                query = query.toLowerCase()
            }
            var func_gs = document.querySelectorAll("g.func_g");
            for (var i = 0; i < func_gs.length; i++) {
                var func_g = func_gs[i];
                if (isregex) {
                    if (regex.test(func_g.getAttribute('data-search'))) indicateMatch(func_g, blink)
                } else {
                    if (~func_g.getAttribute('data-search').indexOf(query)) indicateMatch(func_g, blink)
                }
            }
        }
        var go = module.exports = function initSearch() {
            searchFieldEl.addEventListener("input", debounce(onQueryChange, 200));
            regexCheckEl.addEventListener("change", onQueryChange);
            blinkCheckEl.addEventListener("change", onQueryChange)
        };
        module.exports.refresh = onQueryChange
    }, {
        debounce: 29
    }],
    43: [function(require, module, exports) {
        "use strict";
        var flamegraph = require("../"),
            initSearch = require("./init-search"),
            zoom = require("./zoom")(),
            xtend = require("xtend"),
            resolver;
        var optsTemplate = require("./opts-template.hbs");
        var flamegraphEl = document.getElementById("flamegraph");
        var callgraphFileEl = document.getElementById("callgraph-file");
        var mapFileEl = document.getElementById("map-file");
        var optionsEl = document.getElementById("options");
        var instructionsEl = document.getElementById("instructions");
        var spinnerEl = document.getElementById("spinner");
        var map;
        var showInternalsProfile = {
            unresolveds: true,
            v8internals: true,
            v8gc: true,
            sysinternals: true
        };
        var excludeOptions = ["fonttype", "fontwidth", "fontsize", "imagewidth", "countname", "colors", "timemax", "factor", "hash", "title", "titlestring", "nametype", "bgcolor1", "bgcolor2"];
        var usedMetaKeys = Object.keys(flamegraph.defaultOptsMeta).filter(function(k) {
            return !~excludeOptions.indexOf(k)
        });
        var currentTrace;

        function renderOptions() {
            var opts = flamegraph.defaultOpts,
                meta = flamegraph.defaultOptsMeta;
            var context = usedMetaKeys.reduce(function(acc, k) {
                var type = meta[k].type;
                return acc.concat({
                    name: k,
                    value: opts[k],
                    type: type,
                    description: meta[k].description,
                    min: meta[k].min,
                    max: meta[k].max,
                    step: meta[k].step
                })
            }, []);
            var html = optsTemplate(context);
            optionsEl.innerHTML = html;
            usedMetaKeys.forEach(function(k) {
                var val = opts[k];
                var el = document.getElementById(k);
                el.value = val
            })
        }

        function getOptions() {
            var meta = flamegraph.defaultOptsMeta;
            return usedMetaKeys.reduce(function(acc, k) {
                var el = document.getElementById(k);
                var val = el.value;
                if (meta[k].type === "number") {
                    val = val.length ? parseFloat(val) : Infinity
                } else if (meta[k].type === "boolean") {
                    val = val.length ? Boolean(val) : false
                } else if (meta[k].type === "checkbox") {
                    val = el.checked ? true : false
                }
                acc[k] = val;
                return acc
            }, xtend(flamegraph.defaultOpts))
        }

        function onOptionsChange(e) {
            refresh()
        }

        function registerChange() {
            var inputs = optionsEl.getElementsByTagName("input"),
                i, el;
            for (i = 0; i < inputs.length; i++) {
                el = inputs[i];
                el.onchange = onOptionsChange
            }
        }

        function hookHoverMethods() {
            var details = document.getElementById("details").firstChild;
            window.s = function s(info) {
                details.nodeValue = "Function: " + info
            };
            window.c = function c() {
                details.nodeValue = " "
            }
        }

        function render(arr) {
            if (instructionsEl.parentElement) instructionsEl.parentElement.removeChild(instructionsEl);
            spinnerEl.classList.remove("hidden");
            setTimeout(doWork, 10);

            function doWork() {
                var opts = getOptions();
                var svg;
                try {
                    currentTrace = arr;
                    opts.removenarrows = false;
                    if (opts.internals) opts.profile = xtend(showInternalsProfile);
                    opts.profile.map = map;
                    svg = flamegraph(arr, opts);
                    flamegraphEl.innerHTML = svg;
                    hookHoverMethods();
                    zoom.init(opts)
                } catch (err) {
                    flamegraphEl.innerHTML = '<br><p class="error">' + err.toString() + "</p>"
                }
                spinnerEl.classList.add("hidden")
            }
        }

        function refresh() {
            if (!currentTrace) return;
            render(currentTrace);
            initSearch.refresh()
        }

        function readFile(file, cb) {
            var fileReader = new FileReader;
            fileReader.readAsText(file, "utf-8");
            fileReader.onload = function onload(err) {
                cb(err, fileReader.result)
            }
        }

        function onFile(e, process) {
            var file = e.target.files[0];
            if (!file) return;
            readFile(file, process)
        }

        function processCallgraphFile(e) {
            var arr = e.target.result.split("\n");
            if (resolver) arr = resolver.resolveMulti(arr);
            render(arr)
        }

        function processMapFile(e) {
            map = e.target.result;
            refresh()
        }

        function onCallgraphFile(e) {
            onFile(e, processCallgraphFile)
        }

        function onMapFile(e) {
            onFile(e, processMapFile)
        }
        callgraphFileEl.addEventListener("change", onCallgraphFile);
        mapFileEl.addEventListener("change", onMapFile);
        renderOptions();
        registerChange();
        initSearch(flamegraphEl)
    }, {
        "../": 1,
        "./init-search": 42,
        "./opts-template.hbs": 44,
        "./zoom": 45,
        xtend: 41
    }],
    44: [function(require, module, exports) {
        var Handlebars = require("hbsfy/runtime");
        module.exports = Handlebars.template({
            1: function(depth0, helpers, partials, data) {
                var helper, functionType = "function",
                    helperMissing = helpers.helperMissing,
                    escapeExpression = this.escapeExpression;
                return '<div class="options-input">\n  <p>' + escapeExpression((helper = (helper = helpers.description || (depth0 != null ? depth0.description : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "description",
                    hash: {},
                    data: data
                }) : helper)) + '</p>\n  <input type="' + escapeExpression((helper = (helper = helpers.type || (depth0 != null ? depth0.type : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "type",
                    hash: {},
                    data: data
                }) : helper)) + '" name="' + escapeExpression((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "name",
                    hash: {},
                    data: data
                }) : helper)) + '" id="' + escapeExpression((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "name",
                    hash: {},
                    data: data
                }) : helper)) + '" value"' + escapeExpression((helper = (helper = helpers.value || (depth0 != null ? depth0.value : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "value",
                    hash: {},
                    data: data
                }) : helper)) + '" ' + escapeExpression((helper = (helper = helpers.checked || (depth0 != null ? depth0.checked : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "checked",
                    hash: {},
                    data: data
                }) : helper)) + ' min="' + escapeExpression((helper = (helper = helpers.min || (depth0 != null ? depth0.min : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "min",
                    hash: {},
                    data: data
                }) : helper)) + '" max="' + escapeExpression((helper = (helper = helpers.max || (depth0 != null ? depth0.max : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "max",
                    hash: {},
                    data: data
                }) : helper)) + '" step="' + escapeExpression((helper = (helper = helpers.step || (depth0 != null ? depth0.step : depth0)) != null ? helper : helperMissing, typeof helper === functionType ? helper.call(depth0, {
                    name: "step",
                    hash: {},
                    data: data
                }) : helper)) + '">\n</div>\n'
            },
            compiler: [6, ">= 2.0.0-beta.1"],
            main: function(depth0, helpers, partials, data) {
                var stack1, buffer = "";
                stack1 = helpers.each.call(depth0, depth0, {
                    name: "each",
                    hash: {},
                    fn: this.program(1, data),
                    inverse: this.noop,
                    data: data
                });
                if (stack1 != null) {
                    buffer += stack1
                }
                return buffer
            },
            useData: true
        })
    }, {
        "hbsfy/runtime": 38
    }],
    45: [function(require, module, exports) {
        "use strict";
        var wheel = require("uniwheel");
        var flamegraphEl = document.getElementById("flamegraph");

        function performZoom(zoom) {
            return function z(e) {
                zoom._zoom(e)
            }
        }

        function Zoom() {
            if (!(this instanceof Zoom)) return new Zoom;
            this._flamegraphSvgEl = undefined;
            this._zoomLevel = 1
        }
        var proto = Zoom.prototype;
        module.exports = Zoom;
        proto.init = function init(opts) {
            if (this._flamegraphSvgEl) wheel.off(this._flamegraphSvgEl, this._performZoom);
            this._zoomLevel = 1;
            this._flamegraphSvgEl = document.getElementById("flamegraph-svg");
            this._svgBackgroundEl = document.getElementById("svg-background");
            this._viewBoxWidth = this._flamegraphSvgEl.attributes.width;
            this._viewBoxHeight = this._flamegraphSvgEl.attributes.height;
            this._performZoom = performZoom(this);
            this._opts = opts;
            if (this._flamegraphSvgEl) wheel.on(this._flamegraphSvgEl, this._performZoom, false)
        };
        proto._redrawText = function _redrawText(funcName, textEl, width) {
            var chars = width / 8;
            var text;
            if (chars >= 3) {
                text = funcName.slice(0, chars);
                if (chars < funcName.length) text = text.slice(0, chars - 2) + "..";
                textEl.textContent = text
            } else {
                textEl.textContent = ""
            }
        };
        proto._zoomRects = function _zoomRects() {
            var func, text, rect, children, w, x, funcName;
            var newWidth, newX;
            var funcs = document.querySelectorAll("g.func_g");
            for (var i = 0; i < funcs.length; i++) {
                func = funcs[i];
                text = func.children[2];
                rect = func.children[1];
                w = rect.attributes.width.value;
                newWidth = w * this._zoomLevel;
                if (func.classList.contains("match") && newWidth < 10) newWidth = 10;
                if (newWidth < this._opts.minwidth) func.classList.add("hidden");
                else func.classList.remove("hidden");
                x = rect.attributes.x.value;
                newX = x * this._zoomLevel;
                rect.setAttribute("width", newWidth);
                rect.setAttribute("x", newX);
                if (!text) continue;
                x = text.attributes.x.value;
                text.setAttribute("x", x * this._zoomLevel);
                funcName = func.getAttribute('data-funcname');
                this._redrawText(funcName, text, w * this._zoomLevel)
            }
        };
        proto._zoom = function _zoom(e) {
            if (!e.ctrlKey) return;
            var add = -e.wheelDeltaY / 400 * this._zoomLevel;
            if (!add) return;
            this._zoomLevel = add + this._zoomLevel;
            this._zoomLevel = Math.max(1, this._zoomLevel);
            this._zoomLevel = Math.min(5e3, this._zoomLevel);
            var w, currentWidth, newWidth, newViewBox, viewX;
            currentWidth = this._flamegraphSvgEl.getAttribute("width");
            //w = this._flamegraphSvgEl.attributes.width;
            newWidth = Number(currentWidth) * this._zoomLevel;
            newViewBox = "0 0 " + newWidth + " " + this._viewBoxHeight.value;
            this._flamegraphSvgEl.setAttribute("width", newWidth);
            this._svgBackgroundEl.setAttribute("width", newWidth);
            this._flamegraphSvgEl.setAttribute("viewBox", newViewBox);
            this._zoomRects();
            var scrollRatio = flamegraphEl.scrollLeft / currentWidth;
            flamegraphEl.scrollLeft = newWidth * scrollRatio
        }
    }, {
        uniwheel: 40
    }]
}, {}, [43]);
