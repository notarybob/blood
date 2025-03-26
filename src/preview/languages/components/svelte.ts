import * as svelte from "svelte/compiler";
import { getModuleUrl } from "../../../preview/libraries/skypack";
import { byteArrayToString } from "../../../utils";

let COMPONENT_NAME = `CodeSwingComponent`;
let INIT_CODE = `new ${COMPONENT_NAME}({ target: document.getElementById("app") });`
let SVELTE_PATH = getModuleUrl("svelte");

export async function compileComponent(content: string) {
    let { code } = await svelte.preprocess(content, {
        script: async ({ content, attributes }) => {
            if (attributes.lang !== "ts") {
                return { code: content };
            };
            
            let typescript = require("typescript");
            let compiledContent: string = typescript.transpile(content, { target: "ES2018" })

            return {
                code: compiledContent
            };
        },
        style: async ({ content, attributes }) => {
            if (attributes.lang !== "scss" && attributes.lang !== "sass") {
                return { code: content };
            };

            let sass = require("sass");
            let compiledContent = byteArrayToString(
                sass.renderSync({
                  data: content,
                  indentedSyntax: attributes.lang === "sass",
                }).css
              );

            return {
                code: compiledContent
            };
        }
    });
    
    let { js } = svelte.compile(code, {
        name: COMPONENT_NAME,
        sveltePath: SVELTE_PATH
    });
    
    return [js.code, INIT_CODE];
}