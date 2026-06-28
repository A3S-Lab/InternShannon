/**
 * Monaco Editor environment configuration.
 * Must be imported BEFORE any Monaco component is rendered.
 * Configures Monaco to use local monaco-editor package instead of CDN.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// Tell @monaco-editor/react to use the local monaco instead of CDN
loader.config({ monaco });
