import { apiKey, baseUrl, mail, password } from "./config";
import { EntryReferenceResolver, InvokingService } from "../../entry_references_sdk";
import axios from "axios";
import { Headers } from "./types";

const ITEM_TYPES = {
    ENTRY: "entry"
}

const getDescendants = async (node: any, locale: any, headers: any) => {
    try {
        const descendants = await axios.get(
            `https://app.contentstack.com/api/v3/content_types/${node._content_type_uid || node.type || node.content_type_uid}/entries/${node.uid}/descendants?locale=${locale.code}`,
            { headers }
        );

        const descendantsData: any = await descendants.data;

        return descendantsData;
    }
    catch(error) {
        console.log("Error", error, node);
    }
}   

const login = async () => {
    try {
        const loginRes = await axios.post(`https://${baseUrl}/v3/user-session`, {
            user: {
                email: mail,
                password
            }
        });

        const loginData: any = await loginRes.data;

        return loginData.user.authtoken;
    }
    catch(error) {
        console.log(error);
        return null;
    }
}

const itemRetriever = {
    getItem: async (uid: string, branch: string, language: string, type: string, contentType: string) => {
        const headers = {
            api_key: apiKey,
            authtoken: await login(),
            "Content-Type": "application/json"
        };
        
        const entryResponse = await axios.get(`https://app.contentstack.com/api/v3/content_types/${contentType}/entries/${uid}/descendants?locale=${language}`, { headers });

        let entryData: any = await entryResponse.data;

        entryData = {
            ...entryData,
            _metadata : {
                references: entryData.entries_references
            }
        }

        return entryData;
    }
}

const _referenceProcess = (resolvedData: any[]) => ({
    process: (refs: any) => resolvedData.push(refs)
});

const resolveDescendantsData = async (descendantsData: any, locale: string) => {
    try {
        const resolvedData: any[] = [];
        const entryReferenceResolver = new EntryReferenceResolver();
        const modifiedDescendantsData = {
            ...descendantsData,
            _metadata: {
                references: descendantsData.entries_references
            }
        }

        delete modifiedDescendantsData.entries_references;

        await entryReferenceResolver.resolve(modifiedDescendantsData, itemRetriever, _referenceProcess(resolvedData), 10, InvokingService.CMA, "main", locale);

        return resolvedData;
    }
    catch(error) {
        console.log(error);
        return [];
    }
}

const bfs = async (queue: any, visited: any, res: any, headers: Headers, locales: any) => {
    let chunked: any[] = [];

    const masterLocale = locales.find((locale: any) => locale.fallback_locale === null);

    try {        
        // variants for the parent entry
        // base variant -> parent
        // variant A -> parent 
        // variant B -> parent
        const node = queue[0].ref;
        const currLevel = queue[0].level;

        const parentVariantsResponse = await axios.get(
            `https://${baseUrl}/v3/content_types/${node._content_type_uid || node.type}/entries/${node.uid}/variants/`, 
            { headers }
        );

        const parentVariants: any = await parentVariantsResponse.data;
        
        // derive each locale of the single variant
        let localisedVariantsEntries = await Promise.all(parentVariants.entries.map(async (parentVariant: any) => {
            try {
                return await Promise.all(locales.map(async (locale: any) => {
                    try {
                        const res = await axios.get(`https://${baseUrl}/v3/content_types/${node._content_type_uid || node.type}/entries/${node.uid}/variants/${parentVariant._variant._uid}?locale=${locale.code}`, { headers });
                        const { entry }: any = await res.data;
                        return entry;
                    }
                    catch(error) {
                        return null;
                    }
                }));
            }
            catch(error) {
                console.log(error);
                return null;
            }
        }));

        localisedVariantsEntries = localisedVariantsEntries.flat().filter((entry: any) => entry);

        const descendantsData: any = await getDescendants(node, masterLocale, headers);

        const filteredReferences = descendantsData.entries_references.map((ref: any) => {
            return {
                uid: ref.uid,
                title: ref.title,
                locale: masterLocale.code,
                // if the current locale matches the ref.locale sure it is localised and no fallback
                fallback_locale: (masterLocale.fallback_locale) ? (masterLocale.code === ref.locale) ? masterLocale.fallback_locale : ref.locale : null,
                ...((masterLocale.code === ref.locale) ? { localised: true } : { localised: false }),
                version: ref._version,
                content_type_uid: ref._content_type_uid
            }
        });

        let filteredData: any = {
            uid: descendantsData.uid,
            title: descendantsData.title,
            locale: masterLocale.code,
            // if the current locale matches the descendantsData.locale sure it is localised and no fallback
            fallback_locale: (masterLocale.fallback_locale) ? (masterLocale.code === descendantsData.locale) ? masterLocale.fallback_locale : descendantsData.locale : null,
            ...(masterLocale.code === descendantsData.locale ? { localised: true } : { localised: false }),
            version: descendantsData._version,
            content_type_uid: descendantsData._content_type_uid,
            references: filteredReferences,
            variant_uid: "base_variant"
        }

        queue.pop();

        // base variant parent
        chunked.push(filteredData);
        filteredData.references.forEach((ref: any) => {
            if(!visited.has(ref.uid)) {
                visited.add(ref.uid);
                queue.push({ ref, level: currLevel + 1 })
            }
        });

        // adding all the variants base parent
        localisedVariantsEntries.forEach((parentVariant: any) => {
            let data = null;
            if(!parentVariant._metadata || (parentVariant._metadata && !parentVariant._metadata.references)) {
                // fallback_locale needs a locale map to determine the fallback as variant do not provide the fallback_locale
                data = {...filteredData, locale: parentVariant.locale, fallback_locale: (masterLocale.code === parentVariant.locale ? null : masterLocale.code), variant_uid: parentVariant._variant._uid};
            }
            else {
                // filtering the newReferences from the variant
                let newReferences = parentVariant._metadata.references.map((ref: any) => {
                    if(!ref.deleted) {
                        let newRef = {...ref, content_type_uid: ref._content_type_uid};
                        delete newRef._content_type_uid;
                        return newRef;
                    }
                })
                .filter((ref: any) => ref);

                // duplicate the references with the base entry to maintain the all the references
                const allReferences = filteredData.references.map((ref: any) => {
                    const isPresentRef = newReferences.filter((newRef: any) => newRef.content_type_uid === ref.content_type_uid);
                    if(!(isPresentRef.length)) {
                        return ref;
                    }
                    else {
                        return isPresentRef;
                    }
                });

                newReferences = allReferences.map((ref: any) => ref);

                // to avoid duplicates in case if any
                newReferences = Array.from(new Set(newReferences.flat()));

                data = {...filteredData, title: parentVariant.title, locale: parentVariant.locale, fallback_locale: (masterLocale.code === parentVariant.locale ? null : masterLocale.code), references: newReferences, variant_uid: parentVariant._variant._uid};
            }
            
            data && chunked.push(data);
            data && data.references.forEach((dataRef: any) => {
                if(!visited.has(dataRef.uid)) {
                    visited.add(dataRef.uid);
                    queue.push({ ref: dataRef, level: currLevel + 1 })
                }
            });
        });

        res.write(JSON.stringify({ items: chunked, _is_last_chunk: false }) + "\n")
        chunked = [];
        console.log(queue);

/* -------------------------------------------------------------------------------------------------------------------------------------------------------- */

        while(queue.length > 0) {
            const frontNode = queue.shift();
            const node = frontNode.ref;
            const currLevel = frontNode.level;

            await Promise.all(locales.map(async (locale: any) => {
                // API call for each item's descendants
                const descendantsData: any = await getDescendants(node, locale, headers);

                // filter the entries_references
                const filteredReferences = descendantsData.entries_references.map((ref: any) => {
                    return {
                        uid: ref.uid,
                        title: ref.title,
                        locale: locale.code,
                        // if the current locale matches the ref.locale sure it is localised and no fallback
                        fallback_locale: (locale.fallback_locale) ? (locale.code === ref.locale) ? locale.fallback_locale : ref.locale : null,
                        ...((locale.code === ref.locale) ? { localised: true } : { localised: false }),
                        version: ref._version,
                        content_type_uid: ref._content_type_uid,
                        parent_uid: frontNode.ref.uid
                    }
                });

                const filteredData = {
                    uid: descendantsData.uid,
                    title: descendantsData.title,
                    locale: locale.code,
                    // if the current locale matches the descendantsData.locale sure it is localised and no fallback
                    fallback_locale: (locale.fallback_locale) ? (locale.code === descendantsData.locale) ? locale.fallback_locale : descendantsData.locale : null,
                    ...(locale.code === descendantsData.locale ? { localised: true } : { localised: false }),
                    version: descendantsData._version,
                    content_type_uid: descendantsData._content_type_uid,
                    references: filteredReferences,
                    variant_uid: node.variant_uid
                }

                chunked.push(filteredData);

                const references = descendantsData.entries_references;
    
                references.forEach((ref: any) => {
                    // if not visited
                    if(!visited.has(ref.uid)) {
                        visited.add(ref.uid);
                        queue.push({ ref, level: currLevel + 1 });
                    }
                });
            }));

            // when the current level ends send the chunk to the client
            if(queue.length > 0 && currLevel !== queue[0].level) {
                res.write(JSON.stringify({ items: chunked, _is_last_chunk: false }) + "\n")
                chunked = [];
            }
        }

        // send the last chunk
        res.write(JSON.stringify({ items: chunked, _is_last_chunk: true }) + "\n");
        res.end();
    }
    catch(error) {
        console.log("Here ", error);
        res.status(500).json({
            message: "Server error"
        });
    }   
}

export { login, resolveDescendantsData, bfs };