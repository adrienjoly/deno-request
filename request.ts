import {Buffer, dial} from "deno"
import {BufReader, BufWriter} from "https://deno.land/x/io/bufio.ts";
import {TextProtoReader} from "https://deno.land/x/textproto/mod.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRLF = "\r\n";
const kPortMap = {
    "http:": "80",
    "https:": "443"
};

export async function request(params: {
    url: string,
    method: "GET" | "POST",
    data?: string | { [key: string]: string },
    headers: Headers
}): Promise<{
    status: number,
    statusText: string,
    headers: Headers,
    body: Buffer
}> {
    const {method, data, headers: reqHeaders} = params;
    const url = new URL(params.url);
    let {host, pathname, protocol, port, search} = url;
    if (!port) {
        port = kPortMap[protocol];
    }
    const conn = await dial("tcp", `${host}:${port}`);
    try {
        const writer = new BufWriter(conn);
        const reader = new BufReader(conn);
        const tpReader = new TextProtoReader(reader);
        // start line
        const lines = [`${method} ${pathname}${search} HTTP/1.1`];
        let reqBody = "";
        // data
        if (data) {
            if (typeof data === "string") {
                reqBody = data;
            } else {
                reqBody += Object.entries(data).map((kv) => `${kv[0]}=${[kv[1]]}`).join("&");
            }
            const contentLength = encoder.encode(reqBody).byteLength;
            reqHeaders.set("content-length", `${contentLength}`);
        }
        // header
        if (!reqHeaders.has("host")) {
            reqHeaders.set("host", host);
        }
        for (const [key, value] of reqHeaders) {
            lines.push(`${key}: ${value}`)
        }
        lines.push(CRLF);
        // dump message
        const msg = lines.join(CRLF) + reqBody;
        await writer.write(encoder.encode(msg));
        await writer.flush();
        // read status line
        const [resLine, state] = await tpReader.readLine();
        const [m, _, status, statusText] = resLine.match(/^([^ ]+)? (\d{3}) (.+?)$/);
        // read header
        const [resHeaders] = await tpReader.readMIMEHeader();
        // read body
        const contentLength = parseInt(resHeaders.get("content-length"));
        const bodyBytes = new Uint8Array(contentLength);
        await reader.readFull(bodyBytes);
        return {
            status: parseInt(status),
            statusText,
            headers: resHeaders,
            body: new Buffer(bodyBytes),
        };
    } catch (e) {
        console.error(e);
    } finally {
        conn.close();
    }
}