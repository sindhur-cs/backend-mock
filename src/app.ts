import express, { Request, Response } from "express";
import { Item } from "./types";
import axios from "axios";
import cors from "cors";
import { apiKey } from "./config";
import { bfs, login, resolveDescendantsData } from "./helper";

const app = express();

app.use(express.json());
app.use(cors());

app.get("/api/v3/items/proposal-1", async (req: Request, res: Response): Promise<any> => {
    const { include_count, page, size } = req.query;
    const { items, expected_fields } = req.body;

    // Validate required query parameters
    if (!include_count || !page || !size) {
        return res.status(400).json({
            status: "error",
            message: "Missing required query parameters: include_count, page, or size.",
        });
    }

    // Validate that page and size are numbers
    if (isNaN(Number(page)) || isNaN(Number(size))) {
        return res.status(400).json({
            status: "error",
            message: "'page' and 'size' query parameters must be valid numbers.",
        });
    }

    // Parse the query parameters after validation
    const includeCount = JSON.parse(include_count as string);
    const includePage = parseInt(page as string, 10);
    const includeSize = parseInt(size as string, 10);

    // Ensure page is non-negative and size is a positive number
    if (includePage < 0 || includeSize <= 0) {
        return res.status(400).json({
            status: "error",
            message: "'page' must be 0 or greater, and 'size' must be a positive number.",
        });
    }

    try {
        // Fetch and process data
        const resolvedItems = await Promise.all(
            items.map(async (item: Item) => {
                try {
                    const headers = {
                        api_key: apiKey,
                        authtoken: await login(),
                        "Content-Type": "application/json",
                    };

                    // API call for each item's descendants
                    const descendants = await axios.get(
                        `https://app.contentstack.com/api/v3/content_types/${item.type}/entries/${item.uid}/descendants?locale=${item.locale}`,
                        { headers }
                    );

                    const descendantsData = await descendants.data;

                    // Resolve descendants data
                    const resolvedData = await resolveDescendantsData(descendantsData, item.locale);
                    return resolvedData;
                } catch (error) {
                    console.error("Error resolving item:", error);
                }
            })
        );

        // Flatten resolved data
        const resolvedItemsData = resolvedItems.flat();

        // Pagination
        // for 0 if size is 9 then 0 -> 8, for 1: 9 -> 17 and so on
        const start = includePage * includeSize;
        const end = start + includeSize;
        const paginatedItems = resolvedItemsData.slice(start, end);

        const result = {
            items: paginatedItems,
            ...(includeCount ? { count: resolvedItemsData.length } : {}),
        };

        res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).json({
            status: "error",
            message: "Internal server error. Please try again later.",
        });
    }
});

app.get("/api/v3/items/proposal-2", async (req: Request, res: Response) => {
    const { items, expected_fields } = req.body;
    const CHUNK_SIZE = 3;

    const headers = new Map([["Content-Type", "application/json"], ["Transfer-Encoding", "chunked"]]);
    res.setHeaders(headers);

    try {
        let chunks: any[] = [];

        // Fetch and process data
        await Promise.all(items.map(async (item: Item) => {
            try {
                const headers = {
                    api_key: apiKey,
                    authtoken: await login(),
                    "Content-Type": "application/json",
                };

                // API call for each item's descendants
                const descendants = await axios.get(
                    `https://app.contentstack.com/api/v3/content_types/${item.type}/entries/${item.uid}/descendants?locale=${item.locale}`,
                    { headers }
                );

                const descendantsData = await descendants.data;

                // Resolve descendants data
                const resolvedData = await resolveDescendantsData(descendantsData, item.locale);

                chunks.push(...resolvedData);

                const items = chunks.length >= CHUNK_SIZE ? chunks.splice(0, CHUNK_SIZE) : chunks.splice(0, chunks.length);
                
                res.write(JSON.stringify({ items, is_last_chunk: false}) + "\n");
            } catch (error) {
                console.error("Error resolving item:", error);
            }
        }));

        // if length is remaining
        while(chunks.length >= CHUNK_SIZE) {
            res.write(JSON.stringify({ items: chunks.splice(0, CHUNK_SIZE), is_last_chunk: false }) + "\n");
        }

        const itemsChunk = chunks.length === 0 ? [] : chunks.splice(0, chunks.length);

        res.write(JSON.stringify({ items: itemsChunk, is_last_chunk: true }) + "\n");
        res.end();
    }
    catch(error) {
        res.status(500).json({
            status: "error",
            message: "Internal server error. Please try again later.",
        });
    }
});

app.get("/api/v3/items/bfs", async (req: Request, res: Response) => {
    const { parent } = req.body;
    const queue: any = [];
    const visited: any = new Set();

    res.setHeaders(new Map([["Content-Type", "application/json"], ["Transfer-Encoding", "chunked"]]));

    try {
        queue.push({ ref: parent, level: 0});
        visited.add(parent.uid);

        await bfs(queue, visited, res);

        // res.status(200).json({ items: bfsResult, count: bfsResult.length });
    }
    catch(error) {
        console.log(error);
        res.status(500).json({
            message: "Server error"
        });
    }
});

export default app;