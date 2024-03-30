function forwardFetchResponse(from, to) {
    let statusCode = from.status;
    let statusText = from.statusText;

    if (!from.ok) {
        console.log(`Streaming request failed with status ${statusCode} ${statusText}`);
    }

    // Avoid sending 401 responses as they reset the client Basic auth.
    // This can produce an interesting artifact as "400 Unauthorized", but it's not out of spec.
    // https://www.rfc-editor.org/rfc/rfc9110.html#name-overview-of-status-codes
    // "The reason phrases listed here are only recommendations -- they can be replaced by local
    //  equivalents or left out altogether without affecting the protocol."
    if (statusCode === 401) {
        statusCode = 400;
    }

    to.statusCode = statusCode;
    to.statusMessage = statusText;
    from.body.pipe(to);

    to.socket.on('close', function () {
        if (from.body instanceof Readable) from.body.destroy(); // Close the remote stream
        to.end(); // End the Express response
    });

    from.body.on('end', function () {
        console.log('Streaming request finished');
        to.end();
    });
}
const endpointUrl = isTextCompletion && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.OPENROUTER ?
`${apiUrl}/completions` :
`${apiUrl}/chat/completions`;
const config = {
    method: 'post',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        ...headers,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
    timeout: 0,
};
const router = express.Router();

router.post('/status', jsonParser, async function (request, response_getstatus_openai) {
    if (!request.body) return response_getstatus_openai.sendStatus(400);

    let api_url;
    let api_key_openai;
    let headers;

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENAI) {
        api_url = new URL(request.body.reverse_proxy || API_OPENAI).toString();
        api_key_openai = request.body.reverse_proxy ? request.body.proxy_password : readSecret(SECRET_KEYS.OPENAI);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER) {
        api_url = 'https://openrouter.ai/api/v1';
        api_key_openai = readSecret(SECRET_KEYS.OPENROUTER);
        // OpenRouter needs to pass the referer: https://openrouter.ai/docs
        headers = { 'HTTP-Referer': request.headers.referer };
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MISTRALAI) {
        api_url = 'https://api.mistral.ai/v1';
        api_key_openai = readSecret(SECRET_KEYS.MISTRALAI);
        headers = {};
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
        api_url = request.body.custom_url;
        api_key_openai = readSecret(SECRET_KEYS.CUSTOM);
        headers = {};
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else {
        console.log('This chat completion source is not supported yet.');
        return response_getstatus_openai.status(400).send({ error: true });
    }

    if (!api_key_openai && !request.body.reverse_proxy && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.CUSTOM) {
        console.log('OpenAI API key is missing.');
        return response_getstatus_openai.status(400).send({ error: true });
    }

    try {
        const response = await fetch(api_url + '/models', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + api_key_openai,
                ...headers,
            },
        });

        if (response.ok) {
            const data = await response.json();
            response_getstatus_openai.send(data);

            if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER && Array.isArray(data?.data)) {
                let models = [];

                data.data.forEach(model => {
                    const context_length = model.context_length;
                    const tokens_dollar = Number(1 / (1000 * model.pricing?.prompt));
                    const tokens_rounded = (Math.round(tokens_dollar * 1000) / 1000).toFixed(0);
                    models[model.id] = {
                        tokens_per_dollar: tokens_rounded + 'k',
                        context_length: context_length,
                    };
                });

                console.log('Available OpenRouter models:', models);
            } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.MISTRALAI) {
                const models = data?.data;
                console.log(models);
            } else {
                const models = data?.data;

                if (Array.isArray(models)) {
                    const modelIds = models.filter(x => x && typeof x === 'object').map(x => x.id).sort();
                    console.log('Available OpenAI models:', modelIds);
                } else {
                    console.log('OpenAI endpoint did not return a list of models.');
                }
            }
        }
        else {
            console.log('OpenAI status check failed. Either Access Token is incorrect or API endpoint is down.');
            response_getstatus_openai.send({ error: true, can_bypass: true, data: { data: [] } });
        }
    } catch (e) {
        console.error(e);

        if (!response_getstatus_openai.headersSent) {
            response_getstatus_openai.send({ error: true });
        } else {
            response_getstatus_openai.end();
        }
    }
});
router.post('/generate', jsonParser, function (request, response) {
    if (!request.body) return response.status(400).send({ error: true });

    switch (request.body.chat_completion_source) {
        case CHAT_COMPLETION_SOURCES.CLAUDE: return sendClaudeRequest(request, response);
        case CHAT_COMPLETION_SOURCES.SCALE: return sendScaleRequest(request, response);
        case CHAT_COMPLETION_SOURCES.AI21: return sendAI21Request(request, response);
        case CHAT_COMPLETION_SOURCES.MAKERSUITE: return sendMakerSuiteRequest(request, response);
        case CHAT_COMPLETION_SOURCES.MISTRALAI: return sendMistralAIRequest(request, response);
    }

    let apiUrl;
    let apiKey;
    let headers;
    let bodyParams;

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENAI) {
        apiUrl = new URL(request.body.reverse_proxy || API_OPENAI).toString();
        apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(SECRET_KEYS.OPENAI);
        headers = {};
        bodyParams = {};

        if (getConfigValue('openai.randomizeUserId', false)) {
            bodyParams['user'] = uuidv4();
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENROUTER) {
        apiUrl = 'https://openrouter.ai/api/v1';
        apiKey = readSecret(SECRET_KEYS.OPENROUTER);
        // OpenRouter needs to pass the referer: https://openrouter.ai/docs
        headers = { 'HTTP-Referer': request.headers.referer };
        bodyParams = { 'transforms': ['middle-out'] };

        if (request.body.min_p !== undefined) {
            bodyParams['min_p'] = request.body.min_p;
        }

        if (request.body.top_a !== undefined) {
            bodyParams['top_a'] = request.body.top_a;
        }

        if (request.body.use_fallback) {
            bodyParams['route'] = 'fallback';
        }
    } else if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
        apiUrl = request.body.custom_url;
        apiKey = readSecret(SECRET_KEYS.CUSTOM);
        headers = {};
        bodyParams = {};
        mergeObjectWithYaml(bodyParams, request.body.custom_include_body);
        mergeObjectWithYaml(headers, request.body.custom_include_headers);
    } else {
        console.log('This chat completion source is not supported yet.');
        return response.status(400).send({ error: true });
    }

    if (!apiKey && !request.body.reverse_proxy && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.CUSTOM) {
        console.log('OpenAI API key is missing.');
        return response.status(400).send({ error: true });
    }

    // Add custom stop sequences
    if (Array.isArray(request.body.stop) && request.body.stop.length > 0) {
        bodyParams['stop'] = request.body.stop;
    }

    const isTextCompletion = Boolean(request.body.model && TEXT_COMPLETION_MODELS.includes(request.body.model)) || typeof request.body.messages === 'string';
    const textPrompt = isTextCompletion ? convertTextCompletionPrompt(request.body.messages) : '';
    const endpointUrl = isTextCompletion && request.body.chat_completion_source !== CHAT_COMPLETION_SOURCES.OPENROUTER ?
        `${apiUrl}/completions` :
        `${apiUrl}/chat/completions`;

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', function () {
        controller.abort();
    });

    const requestBody = {
        'messages': isTextCompletion === false ? request.body.messages : undefined,
        'prompt': isTextCompletion === true ? textPrompt : undefined,
        'model': request.body.model,
        'temperature': request.body.temperature,
        'max_tokens': request.body.max_tokens,
        'stream': request.body.stream,
        'presence_penalty': request.body.presence_penalty,
        'frequency_penalty': request.body.frequency_penalty,
        'top_p': request.body.top_p,
        'top_k': request.body.top_k,
        'stop': isTextCompletion === false ? request.body.stop : undefined,
        'logit_bias': request.body.logit_bias,
        'seed': request.body.seed,
        ...bodyParams,
    };

    if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
        excludeKeysByYaml(requestBody, request.body.custom_exclude_body);
    }

    /** @type {import('node-fetch').RequestInit} */
    const config = {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            ...headers,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        timeout: 0,
    };

    console.log(requestBody);

    makeRequest(config, response, request);

    /**
     * Makes a fetch request to the OpenAI API endpoint.
     * @param {import('node-fetch').RequestInit} config Fetch config
     * @param {express.Response} response Express response
     * @param {express.Request} request Express request
     * @param {Number} retries Number of retries left
     * @param {Number} timeout Request timeout in ms
     */
    async function makeRequest(config, response, request, retries = 5, timeout = 5000) {
        try {
            const fetchResponse = await fetch(endpointUrl, config);

            if (request.body.stream) {
                console.log('Streaming request in progress');
                forwardFetchResponse(fetchResponse, response);
                return;
            }

            if (fetchResponse.ok) {
                let json = await fetchResponse.json();
                response.send(json);
                console.log(json);
                console.log(json?.choices[0]?.message);
            } else if (fetchResponse.status === 429 && retries > 0) {
                console.log(`Out of quota, retrying in ${Math.round(timeout / 1000)}s`);
                setTimeout(() => {
                    timeout *= 2;
                    makeRequest(config, response, request, retries - 1, timeout);
                }, timeout);
            } else {
                await handleErrorResponse(fetchResponse);
            }
        } catch (error) {
            console.log('Generation failed', error);
            if (!response.headersSent) {
                response.send({ error: true });
            } else {
                response.end();
            }
        }
    }

    /**
     * @param {import("node-fetch").Response} errorResponse
     */
    async function handleErrorResponse(errorResponse) {
        const responseText = await errorResponse.text();
        const errorData = tryParse(responseText);

        const statusMessages = {
            400: 'Bad request',
            401: 'Unauthorized',
            402: 'Credit limit reached',
            403: 'Forbidden',
            404: 'Not found',
            429: 'Too many requests',
            451: 'Unavailable for legal reasons',
            502: 'Bad gateway',
        };

        const message = errorData?.error?.message || statusMessages[errorResponse.status] || 'Unknown error occurred';
        const quota_error = errorResponse.status === 429 && errorData?.error?.type === 'insufficient_quota';
        console.log(message);

        if (!response.headersSent) {
            response.send({ error: { message }, quota_error: quota_error });
        } else if (!response.writableEnded) {
            response.write(errorResponse);
        } else {
            response.end();
        }
    }
});

async function testApiConnection() {
    // Check if the previous request is still in progress
    if (is_send_press) {
        toastr.info('Please wait for the previous request to complete.');
        return;
    }

    try {
        const reply = await sendOpenAIRequest('quiet', [{ 'role': 'user', 'content': 'Hi' }]);
        console.log(reply);
        toastr.success('API connection successful!');
    }
    catch (err) {
        toastr.error('Could not get a reply from API. Check your connection settings / API key and try again.');
    }
}
/**
 * Sends a streaming request to the API.
 * @param {string} type Generation type
 * @param {object} data Generation data
 * @returns {Promise<any>} Streaming generator
 */
async function sendStreamingRequest(type, data) {
    switch (main_api) {
        case 'openai':
            return await sendOpenAIRequest(type, data.prompt, streamingProcessor.abortController.signal);
        case 'textgenerationwebui':
            return await generateTextGenWithStreaming(data, streamingProcessor.abortController.signal);
        case 'novel':
            return await generateNovelWithStreaming(data, streamingProcessor.abortController.signal);
        case 'kobold':
            return await generateKoboldWithStreaming(data, streamingProcessor.abortController.signal);
        default:
            throw new Error('Streaming is enabled, but the current API does not support streaming.');
    }
}


async function sendOpenAIRequest(type, messages, signal) {
    // Provide default abort signal
    if (!signal) {
        signal = new AbortController().signal;
    }

    // HACK: Filter out null and non-object messages
    if (!Array.isArray(messages)) {
        throw new Error('messages must be an array');
    }

    messages = messages.filter(msg => msg && typeof msg === 'object');

    let logit_bias = {};
    const messageId = getNextMessageId(type);
    const isClaude = oai_settings.chat_completion_source == chat_completion_sources.CLAUDE;
    const isOpenRouter = oai_settings.chat_completion_source == chat_completion_sources.OPENROUTER;
    const isScale = oai_settings.chat_completion_source == chat_completion_sources.SCALE;
    const isAI21 = oai_settings.chat_completion_source == chat_completion_sources.AI21;
    const isGoogle = oai_settings.chat_completion_source == chat_completion_sources.MAKERSUITE;
    const isOAI = oai_settings.chat_completion_source == chat_completion_sources.OPENAI;
    const isMistral = oai_settings.chat_completion_source == chat_completion_sources.MISTRALAI;
    const isCustom = oai_settings.chat_completion_source == chat_completion_sources.CUSTOM;
    const isTextCompletion = (isOAI && textCompletionModels.includes(oai_settings.openai_model)) || (isOpenRouter && oai_settings.openrouter_force_instruct && power_user.instruct.enabled);
    const isQuiet = type === 'quiet';
    const isImpersonate = type === 'impersonate';
    const isContinue = type === 'continue';
    const stream = oai_settings.stream_openai && !isQuiet && !isScale && !isAI21 && !(isGoogle && oai_settings.google_model.includes('bison'));

    if (isTextCompletion && isOpenRouter) {
        messages = convertChatCompletionToInstruct(messages, type);
        replaceItemizedPromptText(messageId, messages);
    }

    if (isAI21) {
        const joinedMsgs = messages.reduce((acc, obj) => {
            const prefix = prefixMap[obj.role];
            return acc + (prefix ? (selected_group ? '\n' : prefix + ' ') : '') + obj.content + '\n';
        }, '');
        messages = substituteParams(joinedMsgs) + (isImpersonate ? `${name1}:` : `${name2}:`);
        replaceItemizedPromptText(messageId, messages);
    }

    // If we're using the window.ai extension, use that instead
    // Doesn't support logit bias yet
    if (oai_settings.chat_completion_source == chat_completion_sources.WINDOWAI) {
        return sendWindowAIRequest(messages, signal, stream);
    }

    const logitBiasSources = [chat_completion_sources.OPENAI, chat_completion_sources.OPENROUTER, chat_completion_sources.SCALE, chat_completion_sources.CUSTOM];
    if (oai_settings.bias_preset_selected
        && logitBiasSources.includes(oai_settings.chat_completion_source)
        && Array.isArray(oai_settings.bias_presets[oai_settings.bias_preset_selected])
        && oai_settings.bias_presets[oai_settings.bias_preset_selected].length) {
        logit_bias = biasCache || await calculateLogitBias();
        biasCache = logit_bias;
    }

    if (isScale && oai_settings.use_alt_scale) {
        return sendAltScaleRequest(messages, logit_bias, signal, type);
    }

    const model = getChatCompletionModel();
    const generate_data = {
        'messages': messages,
        'model': model,
        'temperature': Number(oai_settings.temp_openai),
        'frequency_penalty': Number(oai_settings.freq_pen_openai),
        'presence_penalty': Number(oai_settings.pres_pen_openai),
        'top_p': Number(oai_settings.top_p_openai),
        'max_tokens': oai_settings.openai_max_tokens,
        'stream': stream,
        'logit_bias': logit_bias,
        'stop': getCustomStoppingStrings(openai_max_stop_strings),
        'chat_completion_source': oai_settings.chat_completion_source,
    };

    // Empty array will produce a validation error
    if (!Array.isArray(generate_data.stop) || !generate_data.stop.length) {
        delete generate_data.stop;
    }

    // Remove logit bias and stop strings if it's not supported by the model
    if (isOAI && oai_settings.openai_model.includes('vision') || isOpenRouter && oai_settings.openrouter_model.includes('vision')) {
        delete generate_data.logit_bias;
        delete generate_data.stop;
    }

    // Proxy is only supported for Claude and OpenAI
    if (oai_settings.reverse_proxy && [chat_completion_sources.CLAUDE, chat_completion_sources.OPENAI].includes(oai_settings.chat_completion_source)) {
        validateReverseProxy();
        generate_data['reverse_proxy'] = oai_settings.reverse_proxy;
        generate_data['proxy_password'] = oai_settings.proxy_password;
    }

    if (isClaude) {
        generate_data['top_k'] = Number(oai_settings.top_k_openai);
        generate_data['exclude_assistant'] = oai_settings.exclude_assistant;
        generate_data['claude_use_sysprompt'] = oai_settings.claude_use_sysprompt;
        generate_data['claude_exclude_prefixes'] = oai_settings.claude_exclude_prefixes;
        generate_data['stop'] = getCustomStoppingStrings(); // Claude shouldn't have limits on stop strings.
        generate_data['human_sysprompt_message'] = substituteParams(oai_settings.human_sysprompt_message);
        // Don't add a prefill on quiet gens (summarization)
        if (!isQuiet && !oai_settings.exclude_assistant) {
            generate_data['assistant_prefill'] = substituteParams(oai_settings.assistant_prefill);
        }
    }

    if (isOpenRouter) {
        generate_data['top_k'] = Number(oai_settings.top_k_openai);
        generate_data['min_p'] = Number(oai_settings.min_p_openai);
        generate_data['top_a'] = Number(oai_settings.top_a_openai);
        generate_data['use_fallback'] = oai_settings.openrouter_use_fallback;

        if (isTextCompletion) {
            generate_data['stop'] = getStoppingStrings(isImpersonate, isContinue);
        }
    }

    if (isScale) {
        generate_data['api_url_scale'] = oai_settings.api_url_scale;
    }

    if (isGoogle) {
        const nameStopString = isImpersonate ? `\n${name2}:` : `\n${name1}:`;
        const stopStringsLimit = 3; // 5 - 2 (nameStopString and new_chat_prompt)
        generate_data['top_k'] = Number(oai_settings.top_k_openai);
        generate_data['stop'] = [nameStopString, oai_settings.new_chat_prompt, ...getCustomStoppingStrings(stopStringsLimit)];
    }

    if (isAI21) {
        generate_data['top_k'] = Number(oai_settings.top_k_openai);
        generate_data['count_pen'] = Number(oai_settings.count_pen);
        generate_data['stop_tokens'] = [name1 + ':', oai_settings.new_chat_prompt, oai_settings.new_group_chat_prompt];
    }

    if (isMistral) {
        generate_data['safe_prompt'] = false; // already defaults to false, but just incase they change that in the future.
    }

    if (isCustom) {
        generate_data['custom_url'] = oai_settings.custom_url;
        generate_data['custom_include_body'] = oai_settings.custom_include_body;
        generate_data['custom_exclude_body'] = oai_settings.custom_exclude_body;
        generate_data['custom_include_headers'] = oai_settings.custom_include_headers;
    }

    if ((isOAI || isOpenRouter || isMistral || isCustom) && oai_settings.seed >= 0) {
        generate_data['seed'] = oai_settings.seed;
    }

    const generate_url = '/api/backends/chat-completions/generate';
    const response = await fetch(generate_url, {
        method: 'POST',
        body: JSON.stringify(generate_data),
        headers: getRequestHeaders(),
        signal: signal,
    });

    if (!response.ok) {
        tryParseStreamingError(response, await response.text());
        throw new Error(`Got response status ${response.status}`);
    }
    if (stream) {
        let reader;
        let isSSEStream = oai_settings.chat_completion_source !== chat_completion_sources.MAKERSUITE;
        if (isSSEStream) {
            const eventStream = new EventSourceStream();
            response.body.pipeThrough(eventStream);
            reader = eventStream.readable.getReader();
        } else {
            reader = response.body.getReader();
        }
        return async function* streamData() {
            let text = '';
            let utf8Decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) return;
                const rawData = isSSEStream ? value.data : utf8Decoder.decode(value, { stream: true });
                if (isSSEStream && rawData === '[DONE]') return;
                tryParseStreamingError(response, rawData);
                text += getStreamingReply(JSON.parse(rawData));
                yield { text, swipes: [] };
            }
        };
    }
    else {
        const data = await response.json();

        checkQuotaError(data);

        if (data.error) {
            toastr.error(data.error.message || response.statusText, 'API returned an error');
            throw new Error(data);
        }

        return !isTextCompletion ? data.choices[0]['message']['content'] : data.choices[0]['text'];
    }
}

function getStreamingReply(data) {
    if (oai_settings.chat_completion_source == chat_completion_sources.CLAUDE) {
        return data?.completion || '';
    } else if (oai_settings.chat_completion_source == chat_completion_sources.MAKERSUITE) {
        return data?.candidates[0].content.parts[0].text || '';
    } else {
        return data.choices[0]?.delta?.content || data.choices[0]?.message?.content || data.choices[0]?.text || '';
    }
}



async function Generate(type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, maxLoops, quietName } = {}, dryRun = false) {
    console.log('Generate entered');
    eventSource.emit(event_types.GENERATION_STARTED, type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage, maxLoops }, dryRun);
    setGenerationProgress(0);
    generation_started = new Date();

    // Don't recreate abort controller if signal is passed
    if (!(abortController && signal)) {
        abortController = new AbortController();
    }

    // OpenAI doesn't need instruct mode. Use OAI main prompt instead.
    const isInstruct = power_user.instruct.enabled && main_api !== 'openai';
    const isImpersonate = type == 'impersonate';

    let message_already_generated = isImpersonate ? `${name1}: ` : `${name2}: `;

    if (!(dryRun || type == 'regenerate' || type == 'swipe' || type == 'quiet')) {
        const interruptedByCommand = await processCommands($('#send_textarea').val());

        if (interruptedByCommand) {
            //$("#send_textarea").val('').trigger('input');
            unblockGeneration();
            return Promise.resolve();
        }
    }

    if (main_api == 'kobold' && kai_settings.streaming_kobold && !kai_flags.can_use_streaming) {
        toastr.error('Streaming is enabled, but the version of Kobold used does not support token streaming.', undefined, { timeOut: 10000, preventDuplicates: true });
        unblockGeneration();
        return Promise.resolve();
    }

    if (main_api === 'textgenerationwebui' &&
        textgen_settings.streaming &&
        textgen_settings.legacy_api &&
        (textgen_settings.type === OOBA || textgen_settings.type === APHRODITE)) {
        toastr.error('Streaming is not supported for the Legacy API. Update Ooba and use new API to enable streaming.', undefined, { timeOut: 10000, preventDuplicates: true });
        unblockGeneration();
        return Promise.resolve();
    }

    if (isHordeGenerationNotAllowed()) {
        unblockGeneration();
        return Promise.resolve();
    }

    if (!dryRun) {
        // Hide swipes if not in a dry run.
        hideSwipeButtons();
        // If generated any message, set the flag to indicate it can't be recreated again.
        chat_metadata['tainted'] = true;
    }

    if (selected_group && !is_group_generating) {
        if (!dryRun) {
            // Returns the promise that generateGroupWrapper returns; resolves when generation is done
            return generateGroupWrapper(false, type, { quiet_prompt, force_chid, signal: abortController.signal, quietImage, maxLoops });
        }

        const characterIndexMap = new Map(characters.map((char, index) => [char.avatar, index]));
        const group = groups.find((x) => x.id === selected_group);

        const enabledMembers = group.members.reduce((acc, member) => {
            if (!group.disabled_members.includes(member) && !acc.includes(member)) {
                acc.push(member);
            }
            return acc;
        }, []);

        const memberIds = enabledMembers
            .map((member) => characterIndexMap.get(member))
            .filter((index) => index !== undefined && index !== null);

        if (memberIds.length > 0) {
            setCharacterId(memberIds[0]);
            setCharacterName('');
        } else {
            console.log('No enabled members found');
            unblockGeneration();
            return Promise.resolve();
        }
    }

    //#########QUIET PROMPT STUFF##############
    //this function just gives special care to novel quiet instruction prompts
    if (quiet_prompt) {
        quiet_prompt = substituteParams(quiet_prompt);
        quiet_prompt = main_api == 'novel' && !quietToLoud ? adjustNovelInstructionPrompt(quiet_prompt) : quiet_prompt;
    }

    const isChatValid = online_status != 'no_connection' && this_chid != undefined && this_chid !== 'invalid-safety-id';

    // We can't do anything because we're not in a chat right now. (Unless it's a dry run, in which case we need to
    // assemble the prompt so we can count its tokens regardless of whether a chat is active.)
    if (!dryRun && !isChatValid) {
        if (this_chid === undefined || this_chid === 'invalid-safety-id') {
            toastr.warning('Сharacter is not selected');
        }
        is_send_press = false;
        return Promise.resolve();
    }

    let textareaText;
    if (type !== 'regenerate' && type !== 'swipe' && type !== 'quiet' && !isImpersonate && !dryRun) {
        is_send_press = true;
        textareaText = String($('#send_textarea').val());
        $('#send_textarea').val('').trigger('input');
    } else {
        textareaText = '';
        if (chat.length && chat[chat.length - 1]['is_user']) {
            //do nothing? why does this check exist?
        }
        else if (type !== 'quiet' && type !== 'swipe' && !isImpersonate && !dryRun && chat.length) {
            chat.length = chat.length - 1;
            count_view_mes -= 1;
            $('#chat').children().last().hide(250, function () {
                $(this).remove();
            });
            await eventSource.emit(event_types.MESSAGE_DELETED, chat.length);
        }
    }

    const isContinue = type == 'continue';

    // Rewrite the generation timer to account for the time passed for all the continuations.
    if (isContinue && chat.length) {
        const prevFinished = chat[chat.length - 1]['gen_finished'];
        const prevStarted = chat[chat.length - 1]['gen_started'];

        if (prevFinished && prevStarted) {
            const timePassed = prevFinished - prevStarted;
            generation_started = new Date(Date.now() - timePassed);
            chat[chat.length - 1]['gen_started'] = generation_started;
        }
    }

    if (!dryRun) {
        deactivateSendButtons();
    }

    let { messageBias, promptBias, isUserPromptBias } = getBiasStrings(textareaText, type);

    //*********************************
    //PRE FORMATING STRING
    //*********************************

    //for normal messages sent from user..
    if ((textareaText != '' || hasPendingFileAttachment()) && !automatic_trigger && type !== 'quiet' && !dryRun) {
        // If user message contains no text other than bias - send as a system message
        if (messageBias && !removeMacros(textareaText)) {
            sendSystemMessage(system_message_types.GENERIC, ' ', { bias: messageBias });
        }
        else {
            await sendMessageAsUser(textareaText, messageBias);
        }
    }
    else if (textareaText == '' && !automatic_trigger && !dryRun && type === undefined && main_api == 'openai' && oai_settings.send_if_empty.trim().length > 0) {
        // Use send_if_empty if set and the user message is empty. Only when sending messages normally
        await sendMessageAsUser(oai_settings.send_if_empty.trim(), messageBias);
    }

    let {
        description,
        personality,
        persona,
        scenario,
        mesExamples,
        system,
        jailbreak,
    } = getCharacterCardFields();

    if (isInstruct) {
        system = power_user.prefer_character_prompt && system ? system : baseChatReplace(power_user.instruct.system_prompt, name1, name2);
        system = formatInstructModeSystemPrompt(substituteParams(system, name1, name2, power_user.instruct.system_prompt));
    }

    // Depth prompt (character-specific A/N)
    removeDepthPrompts();
    const groupDepthPrompts = getGroupDepthPrompts(selected_group, Number(this_chid));

    if (selected_group && Array.isArray(groupDepthPrompts) && groupDepthPrompts.length > 0) {
        groupDepthPrompts.forEach((value, index) => {
            setExtensionPrompt('DEPTH_PROMPT_' + index, value.text, extension_prompt_types.IN_CHAT, value.depth, extension_settings.note.allowWIScan);
        });
    } else {
        const depthPromptText = baseChatReplace(characters[this_chid].data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2) || '';
        const depthPromptDepth = characters[this_chid].data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default;
        setExtensionPrompt('DEPTH_PROMPT', depthPromptText, extension_prompt_types.IN_CHAT, depthPromptDepth, extension_settings.note.allowWIScan);
    }

    // Parse example messages
    if (!mesExamples.startsWith('<START>')) {
        mesExamples = '<START>\n' + mesExamples.trim();
    }
    if (mesExamples.replace(/<START>/gi, '').trim().length === 0) {
        mesExamples = '';
    }
    const mesExamplesRaw = mesExamples;
    if (mesExamples && isInstruct) {
        mesExamples = formatInstructModeExamples(mesExamples, name1, name2);
    }

    /**
     * Adds a block heading to the examples string.
     * @param {string} examplesStr
     * @returns {string[]} Examples array with block heading
     */
    function addBlockHeading(examplesStr) {
        const exampleSeparator = power_user.context.example_separator ? `${substituteParams(power_user.context.example_separator)}\n` : '';
        const blockHeading = main_api === 'openai' ? '<START>\n' : exampleSeparator;
        return examplesStr.split(/<START>/gi).slice(1).map(block => `${blockHeading}${block.trim()}\n`);
    }

    let mesExamplesArray = addBlockHeading(mesExamples);
    let mesExamplesRawArray = addBlockHeading(mesExamplesRaw);

    // First message in fresh 1-on-1 chat reacts to user/character settings changes
    if (chat.length) {
        chat[0].mes = substituteParams(chat[0].mes);
    }

    // Collect messages with usable content
    let coreChat = chat.filter(x => !x.is_system);
    if (type === 'swipe') {
        coreChat.pop();
    }

    coreChat = await Promise.all(coreChat.map(async (chatItem, index) => {
        let message = chatItem.mes;
        let regexType = chatItem.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        let options = { isPrompt: true };

        let regexedMessage = getRegexedString(message, regexType, options);
        regexedMessage = await appendFileContent(chatItem, regexedMessage);

        return {
            ...chatItem,
            mes: regexedMessage,
            index,
        };
    }));

    // Determine token limit
    let this_max_context = getMaxContextSize();

    if (!dryRun && type !== 'quiet') {
        console.debug('Running extension interceptors');
        const aborted = await runGenerationInterceptors(coreChat, this_max_context);

        if (aborted) {
            console.debug('Generation aborted by extension interceptors');
            unblockGeneration();
            return Promise.resolve();
        }
    } else {
        console.debug('Skipping extension interceptors for dry run');
    }

    console.log(`Core/all messages: ${coreChat.length}/${chat.length}`);

    // kingbri MARK: - Make sure the prompt bias isn't the same as the user bias
    if ((promptBias && !isUserPromptBias) || power_user.always_force_name2 || main_api == 'novel') {
        force_name2 = true;
    }

    if (isImpersonate) {
        force_name2 = false;
    }

    //////////////////////////////////

    let chat2 = [];
    let continue_mag = '';
    for (let i = coreChat.length - 1, j = 0; i >= 0; i--, j++) {
        // For OpenAI it's only used in WI
        if (main_api == 'openai' && (!world_info || world_info.length === 0)) {
            console.debug('No WI, skipping chat2 for OAI');
            break;
        }

        chat2[i] = formatMessageHistoryItem(coreChat[j], isInstruct, false);

        if (j === 0 && isInstruct) {
            // Reformat with the first output sequence (if any)
            chat2[i] = formatMessageHistoryItem(coreChat[j], isInstruct, force_output_sequence.FIRST);
        }

        // Do not suffix the message for continuation
        if (i === 0 && isContinue) {
            if (isInstruct) {
                // Reformat with the last output sequence (if any)
                chat2[i] = formatMessageHistoryItem(coreChat[j], isInstruct, force_output_sequence.LAST);
            }

            chat2[i] = chat2[i].slice(0, chat2[i].lastIndexOf(coreChat[j].mes) + coreChat[j].mes.length);
            continue_mag = coreChat[j].mes;
        }
    }

    // Adjust token limit for Horde
    let adjustedParams;
    if (main_api == 'koboldhorde' && (horde_settings.auto_adjust_context_length || horde_settings.auto_adjust_response_length)) {
        try {
            adjustedParams = await adjustHordeGenerationParams(max_context, amount_gen);
        }
        catch {
            unblockGeneration();
            return Promise.resolve();
        }
        if (horde_settings.auto_adjust_context_length) {
            this_max_context = (adjustedParams.maxContextLength - adjustedParams.maxLength);
        }
    }

    // Extension added strings
    // Set non-WI AN
    setFloatingPrompt();
    // Add WI to prompt (and also inject WI to AN value via hijack)

    let { worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoDepth } = await getWorldInfoPrompt(chat2, this_max_context);

    if (skipWIAN !== true) {
        console.log('skipWIAN not active, adding WIAN');
        // Add all depth WI entries to prompt
        flushWIDepthInjections();
        if (Array.isArray(worldInfoDepth)) {
            worldInfoDepth.forEach((e) => {
                const joinedEntries = e.entries.join('\n');
                setExtensionPrompt(`customDepthWI-${e.depth}`, joinedEntries, extension_prompt_types.IN_CHAT, e.depth);
            });
        }
    } else {
        console.log('skipping WIAN');
    }

    // Add persona description to prompt
    addPersonaDescriptionExtensionPrompt();
    // Call combined AN into Generate
    let allAnchors = getAllExtensionPrompts();
    const beforeScenarioAnchor = getExtensionPrompt(extension_prompt_types.BEFORE_PROMPT).trimStart();
    const afterScenarioAnchor = getExtensionPrompt(extension_prompt_types.IN_PROMPT);
    let zeroDepthAnchor = getExtensionPrompt(extension_prompt_types.IN_CHAT, 0, ' ');

    const storyStringParams = {
        description: description,
        personality: personality,
        persona: persona,
        scenario: scenario,
        system: isInstruct ? system : '',
        char: name2,
        user: name1,
        wiBefore: worldInfoBefore,
        wiAfter: worldInfoAfter,
        loreBefore: worldInfoBefore,
        loreAfter: worldInfoAfter,
        mesExamples: mesExamplesArray.join(''),
        mesExamplesRaw: mesExamplesRawArray.join(''),
    };

    const storyString = renderStoryString(storyStringParams);

    // Story string rendered, safe to remove
    if (power_user.strip_examples) {
        mesExamplesArray = [];
    }

    let oaiMessages = [];
    let oaiMessageExamples = [];

    if (main_api === 'openai') {
        message_already_generated = '';
        oaiMessages = setOpenAIMessages(coreChat);
        oaiMessageExamples = setOpenAIMessageExamples(mesExamplesArray);
    }

    // hack for regeneration of the first message
    if (chat2.length == 0) {
        chat2.push('');
    }

    let examplesString = '';
    let chatString = '';
    let cyclePrompt = '';

    function getMessagesTokenCount() {
        const encodeString = [
            storyString,
            examplesString,
            chatString,
            allAnchors,
            quiet_prompt,
            cyclePrompt,
        ].join('').replace(/\r/gm, '');
        return getTokenCount(encodeString, power_user.token_padding);
    }

    // Force pinned examples into the context
    let pinExmString;
    if (power_user.pin_examples) {
        pinExmString = examplesString = mesExamplesArray.join('');
    }

    // Only add the chat in context if past the greeting message
    if (isContinue && (chat2.length > 1 || main_api === 'openai')) {
        cyclePrompt = chat2.shift();
    }

    // Collect enough messages to fill the context
    let arrMes = [];
    let tokenCount = getMessagesTokenCount();
    for (let item of chat2) {
        // not needed for OAI prompting
        if (main_api == 'openai') {
            break;
        }

        tokenCount += getTokenCount(item.replace(/\r/gm, ''));
        chatString = item + chatString;
        if (tokenCount < this_max_context) {
            arrMes[arrMes.length] = item;
        } else {
            break;
        }

        // Prevent UI thread lock on tokenization
        await delay(1);
    }

    if (main_api !== 'openai') {
        setInContextMessages(arrMes.length, type);
    }

    // Estimate how many unpinned example messages fit in the context
    tokenCount = getMessagesTokenCount();
    let count_exm_add = 0;
    if (!power_user.pin_examples) {
        for (let example of mesExamplesArray) {
            tokenCount += getTokenCount(example.replace(/\r/gm, ''));
            examplesString += example;
            if (tokenCount < this_max_context) {
                count_exm_add++;
            } else {
                break;
            }
            await delay(1);
        }
    }

    let mesSend = [];
    console.debug('calling runGenerate');

    if (isContinue) {
        // Coping mechanism for OAI spacing
        const isForceInstruct = isOpenRouterWithInstruct();
        if (main_api === 'openai' && !isForceInstruct && !cyclePrompt.endsWith(' ')) {
            cyclePrompt += ' ';
            continue_mag += ' ';
        }
        message_already_generated = continue_mag;
    }

    const originalType = type;

    if (!dryRun) {
        is_send_press = true;
    }

    generatedPromptCache += cyclePrompt;
    if (generatedPromptCache.length == 0 || type === 'continue') {
        console.debug('generating prompt');
        chatString = '';
        arrMes = arrMes.reverse();
        arrMes.forEach(function (item, i, arr) {// For added anchors and others
            // OAI doesn't need all of this
            if (main_api === 'openai') {
                return;
            }

            // Cohee: I'm not even sure what this is for anymore
            if (i === arrMes.length - 1 && type !== 'continue') {
                item = item.replace(/\n?$/, '');
            }

            mesSend[mesSend.length] = { message: item, extensionPrompts: [] };
        });
    }

    let mesExmString = '';

    function setPromptString() {
        if (main_api == 'openai') {
            return;
        }

        console.debug('--setting Prompt string');
        mesExmString = pinExmString ?? mesExamplesArray.slice(0, count_exm_add).join('');

        if (mesSend.length) {
            mesSend[mesSend.length - 1].message = modifyLastPromptLine(mesSend[mesSend.length - 1].message);
        }
    }

    function modifyLastPromptLine(lastMesString) {
        //#########QUIET PROMPT STUFF PT2##############

        // Add quiet generation prompt at depth 0
        if (quiet_prompt && quiet_prompt.length) {

            // here name1 is forced for all quiet prompts..why?
            const name = name1;
            //checks if we are in instruct, if so, formats the chat as such, otherwise just adds the quiet prompt
            const quietAppend = isInstruct ? formatInstructModeChat(name, quiet_prompt, false, true, '', name1, name2, false) : `\n${quiet_prompt}`;

            //This begins to fix quietPrompts (particularly /sysgen) for instruct
            //previously instruct input sequence was being appended to the last chat message w/o '\n'
            //and no output sequence was added after the input's content.
            //TODO: respect output_sequence vs last_output_sequence settings
            //TODO: decide how to prompt this to clarify who is talking 'Narrator', 'System', etc.
            if (isInstruct) {
                lastMesString += '\n' + quietAppend; // + power_user.instruct.output_sequence + '\n';
            } else {
                lastMesString += quietAppend;
            }


            // Ross: bailing out early prevents quiet prompts from respecting other instruct prompt toggles
            // for sysgen, SD, and summary this is desireable as it prevents the AI from responding as char..
            // but for idle prompting, we want the flexibility of the other prompt toggles, and to respect them as per settings in the extension
            // need a detection for what the quiet prompt is being asked for...

            // Bail out early?
            if (!isInstruct && !quietToLoud) {
                return lastMesString;
            }
        }


        // Get instruct mode line
        if (isInstruct && !isContinue) {
            const name = (quiet_prompt && !quietToLoud) ? (quietName ?? 'System') : (isImpersonate ? name1 : name2);
            lastMesString += formatInstructModePrompt(name, isImpersonate, promptBias, name1, name2);
        }

        // Get non-instruct impersonation line
        if (!isInstruct && isImpersonate && !isContinue) {
            const name = name1;
            if (!lastMesString.endsWith('\n')) {
                lastMesString += '\n';
            }
            lastMesString += name + ':';
        }

        // Add character's name
        // Force name append on continue (if not continuing on user message)
        if (!isInstruct && force_name2) {
            if (!lastMesString.endsWith('\n')) {
                lastMesString += '\n';
            }
            if (!isContinue || !(chat[chat.length - 1]?.is_user)) {
                lastMesString += `${name2}:`;
            }
        }

        return lastMesString;
    }

    // Clean up the already generated prompt for seamless addition
    function cleanupPromptCache(promptCache) {
        // Remove the first occurrance of character's name
        if (promptCache.trimStart().startsWith(`${name2}:`)) {
            promptCache = promptCache.replace(`${name2}:`, '').trimStart();
        }

        // Remove the first occurrance of prompt bias
        if (promptCache.trimStart().startsWith(promptBias)) {
            promptCache = promptCache.replace(promptBias, '');
        }

        // Add a space if prompt cache doesn't start with one
        if (!/^\s/.test(promptCache) && !isInstruct && !isContinue) {
            promptCache = ' ' + promptCache;
        }

        return promptCache;
    }

    function checkPromptSize() {
        console.debug('---checking Prompt size');
        setPromptString();
        const prompt = [
            storyString,
            mesExmString,
            mesSend.join(''),
            generatedPromptCache,
            allAnchors,
            quiet_prompt,
        ].join('').replace(/\r/gm, '');
        let thisPromptContextSize = getTokenCount(prompt, power_user.token_padding);

        if (thisPromptContextSize > this_max_context) {        //if the prepared prompt is larger than the max context size...
            if (count_exm_add > 0) {                            // ..and we have example mesages..
                count_exm_add--;                            // remove the example messages...
                checkPromptSize();                            // and try agin...
            } else if (mesSend.length > 0) {                    // if the chat history is longer than 0
                mesSend.shift();                            // remove the first (oldest) chat entry..
                checkPromptSize();                            // and check size again..
            } else {
                //end
                console.debug(`---mesSend.length = ${mesSend.length}`);
            }
        }
    }

    if (generatedPromptCache.length > 0 && main_api !== 'openai') {
        console.debug('---Generated Prompt Cache length: ' + generatedPromptCache.length);
        checkPromptSize();
    } else {
        console.debug('---calling setPromptString ' + generatedPromptCache.length);
        setPromptString();
    }

    // Fetches the combined prompt for both negative and positive prompts
    const cfgGuidanceScale = getGuidanceScale();

    // For prompt bit itemization
    let mesSendString = '';

    function getCombinedPrompt(isNegative) {
        // Only return if the guidance scale doesn't exist or the value is 1
        // Also don't return if constructing the neutral prompt
        if (isNegative && (!cfgGuidanceScale || cfgGuidanceScale?.value === 1)) {
            return;
        }

        // OAI has its own prompt manager. No need to do anything here
        if (main_api === 'openai') {
            return '';
        }

        // Deep clone
        let finalMesSend = structuredClone(mesSend);

        // TODO: Rewrite getExtensionPrompt to not require multiple for loops
        // Set all extension prompts where insertion depth > mesSend length
        if (finalMesSend.length) {
            for (let upperDepth = MAX_INJECTION_DEPTH; upperDepth >= finalMesSend.length; upperDepth--) {
                const upperAnchor = getExtensionPrompt(extension_prompt_types.IN_CHAT, upperDepth);
                if (upperAnchor && upperAnchor.length) {
                    finalMesSend[0].extensionPrompts.push(upperAnchor);
                }
            }
        }

        finalMesSend.forEach((mesItem, index) => {
            if (index === 0) {
                return;
            }

            const anchorDepth = Math.abs(index - finalMesSend.length);
            // NOTE: Depth injected here!
            const extensionAnchor = getExtensionPrompt(extension_prompt_types.IN_CHAT, anchorDepth);

            if (anchorDepth >= 0 && extensionAnchor && extensionAnchor.length) {
                mesItem.extensionPrompts.push(extensionAnchor);
            }
        });

        // TODO: Move zero-depth anchor append to work like CFG and bias appends
        if (zeroDepthAnchor?.length && !isContinue) {
            console.debug(/\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1)));
            finalMesSend[finalMesSend.length - 1].message +=
                /\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1))
                    ? zeroDepthAnchor
                    : `${zeroDepthAnchor}`;
        }

        let cfgPrompt = {};
        if (cfgGuidanceScale && cfgGuidanceScale?.value !== 1) {
            cfgPrompt = getCfgPrompt(cfgGuidanceScale, isNegative);
        }

        if (cfgPrompt && cfgPrompt?.value) {
            if (cfgPrompt?.depth === 0) {
                finalMesSend[finalMesSend.length - 1].message +=
                    /\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1))
                        ? cfgPrompt.value
                        : ` ${cfgPrompt.value}`;
            } else {
                // TODO: Make all extension prompts use an array/splice method
                const lengthDiff = mesSend.length - cfgPrompt.depth;
                const cfgDepth = lengthDiff >= 0 ? lengthDiff : 0;
                finalMesSend[cfgDepth].extensionPrompts.push(`${cfgPrompt.value}\n`);
            }
        }

        // Add prompt bias after everything else
        // Always run with continue
        if (!isInstruct && !isImpersonate) {
            if (promptBias.trim().length !== 0) {
                finalMesSend[finalMesSend.length - 1].message +=
                    /\s/.test(finalMesSend[finalMesSend.length - 1].message.slice(-1))
                        ? promptBias.trimStart()
                        : ` ${promptBias.trimStart()}`;
            }
        }

        // Prune from prompt cache if it exists
        if (generatedPromptCache.length !== 0) {
            generatedPromptCache = cleanupPromptCache(generatedPromptCache);
        }

        // Flattens the multiple prompt objects to a string.
        const combine = () => {
            // Right now, everything is suffixed with a newline
            mesSendString = finalMesSend.map((e) => `${e.extensionPrompts.join('')}${e.message}`).join('');

            // add a custom dingus (if defined)
            mesSendString = addChatsSeparator(mesSendString);

            // add chat preamble
            mesSendString = addChatsPreamble(mesSendString);

            let combinedPrompt = beforeScenarioAnchor +
                storyString +
                afterScenarioAnchor +
                mesExmString +
                mesSendString +
                generatedPromptCache;

            combinedPrompt = combinedPrompt.replace(/\r/gm, '');

            if (power_user.collapse_newlines) {
                combinedPrompt = collapseNewlines(combinedPrompt);
            }

            return combinedPrompt;
        };

        let data = {
            api: main_api,
            combinedPrompt: null,
            description,
            personality,
            persona,
            scenario,
            char: name2,
            user: name1,
            worldInfoBefore,
            worldInfoAfter,
            beforeScenarioAnchor,
            afterScenarioAnchor,
            storyString,
            mesExmString,
            mesSendString,
            finalMesSend,
            generatedPromptCache,
            main: system,
            jailbreak,
            naiPreamble: nai_settings.preamble,
        };

        // Before returning the combined prompt, give available context related information to all subscribers.
        eventSource.emitAndWait(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, data);

        // If one or multiple subscribers return a value, forfeit the responsibillity of flattening the context.
        return !data.combinedPrompt ? combine() : data.combinedPrompt;
    }

    // Get the negative prompt first since it has the unmodified mesSend array
    let negativePrompt = main_api == 'textgenerationwebui' ? getCombinedPrompt(true) : undefined;
    let finalPrompt = getCombinedPrompt(false);

    // Include the entire guidance scale object
    const cfgValues = cfgGuidanceScale && cfgGuidanceScale?.value !== 1 ? ({ guidanceScale: cfgGuidanceScale, negativePrompt: negativePrompt }) : null;

    let maxLength = Number(amount_gen); // how many tokens the AI will be requested to generate
    let thisPromptBits = [];

    // TODO: Make this a switch
    if (main_api == 'koboldhorde' && horde_settings.auto_adjust_response_length) {
        maxLength = Math.min(maxLength, adjustedParams.maxLength);
        maxLength = Math.max(maxLength, MIN_LENGTH); // prevent validation errors
    }

    let generate_data;
    if (main_api == 'koboldhorde' || main_api == 'kobold') {
        generate_data = {
            prompt: finalPrompt,
            gui_settings: true,
            max_length: maxLength,
            max_context_length: max_context,
            api_server,
        };

        if (preset_settings != 'gui') {
            const isHorde = main_api == 'koboldhorde';
            const presetSettings = koboldai_settings[koboldai_setting_names[preset_settings]];
            const maxContext = (adjustedParams && horde_settings.auto_adjust_context_length) ? adjustedParams.maxContextLength : max_context;
            generate_data = getKoboldGenerationData(finalPrompt, presetSettings, maxLength, maxContext, isHorde, type);
        }
    }
    else if (main_api == 'textgenerationwebui') {
        generate_data = getTextGenGenerationData(finalPrompt, maxLength, isImpersonate, isContinue, cfgValues, type);
    }
    else if (main_api == 'novel') {
        const presetSettings = novelai_settings[novelai_setting_names[nai_settings.preset_settings_novel]];
        generate_data = getNovelGenerationData(finalPrompt, presetSettings, maxLength, isImpersonate, isContinue, cfgValues, type);
    }
    else if (main_api == 'openai') {
        let [prompt, counts] = await prepareOpenAIMessages({
            name2: name2,
            charDescription: description,
            charPersonality: personality,
            Scenario: scenario,
            worldInfoBefore: worldInfoBefore,
            worldInfoAfter: worldInfoAfter,
            extensionPrompts: extension_prompts,
            bias: promptBias,
            type: type,
            quietPrompt: quiet_prompt,
            quietImage: quietImage,
            cyclePrompt: cyclePrompt,
            systemPromptOverride: system,
            jailbreakPromptOverride: jailbreak,
            personaDescription: persona,
            messages: oaiMessages,
            messageExamples: oaiMessageExamples,
        }, dryRun);
        generate_data = { prompt: prompt };

        // counts will return false if the user has not enabled the token breakdown feature
        if (counts) {
            parseTokenCounts(counts, thisPromptBits);
        }

        if (!dryRun) {
            setInContextMessages(openai_messages_count, type);
        }
    }

    if (dryRun) {
        generatedPromptCache = '';
        return Promise.resolve();
    }

    async function finishGenerating() {
        if (power_user.console_log_prompts) {
            console.log(generate_data.prompt);
        }

        console.debug('rungenerate calling API');

        showStopButton();

        //set array object for prompt token itemization of this message
        let currentArrayEntry = Number(thisPromptBits.length - 1);
        let additionalPromptStuff = {
            ...thisPromptBits[currentArrayEntry],
            rawPrompt: generate_data.prompt || generate_data.input,
            mesId: getNextMessageId(type),
            allAnchors: allAnchors,
            summarizeString: (extension_prompts['1_memory']?.value || ''),
            authorsNoteString: (extension_prompts['2_floating_prompt']?.value || ''),
            smartContextString: (extension_prompts['chromadb']?.value || ''),
            worldInfoString: worldInfoString,
            storyString: storyString,
            beforeScenarioAnchor: beforeScenarioAnchor,
            afterScenarioAnchor: afterScenarioAnchor,
            examplesString: examplesString,
            mesSendString: mesSendString,
            generatedPromptCache: generatedPromptCache,
            promptBias: promptBias,
            finalPrompt: finalPrompt,
            charDescription: description,
            charPersonality: personality,
            scenarioText: scenario,
            this_max_context: this_max_context,
            padding: power_user.token_padding,
            main_api: main_api,
            instruction: isInstruct ? substituteParams(power_user.prefer_character_prompt && system ? system : power_user.instruct.system_prompt) : '',
            userPersona: (power_user.persona_description || ''),
        };

        thisPromptBits = additionalPromptStuff;

        //console.log(thisPromptBits);
        const itemizedIndex = itemizedPrompts.findIndex((item) => item.mesId === thisPromptBits['mesId']);

        if (itemizedIndex !== -1) {
            itemizedPrompts[itemizedIndex] = thisPromptBits;
        }
        else {
            itemizedPrompts.push(thisPromptBits);
        }

        console.debug(`pushed prompt bits to itemizedPrompts array. Length is now: ${itemizedPrompts.length}`);

        if (isStreamingEnabled() && type !== 'quiet') {
            streamingProcessor = new StreamingProcessor(type, force_name2, generation_started, message_already_generated);
            if (isContinue) {
                // Save reply does add cycle text to the prompt, so it's not needed here
                streamingProcessor.firstMessageText = '';
            }

            streamingProcessor.generator = await sendStreamingRequest(type, generate_data);

            hideSwipeButtons();
            let getMessage = await streamingProcessor.generate();
            let messageChunk = cleanUpMessage(getMessage, isImpersonate, isContinue, false);

            if (isContinue) {
                getMessage = continue_mag + getMessage;
            }

            if (streamingProcessor && !streamingProcessor.isStopped && streamingProcessor.isFinished) {
                await streamingProcessor.onFinishStreaming(streamingProcessor.messageId, getMessage);
                streamingProcessor = null;
                triggerAutoContinue(messageChunk, isImpersonate);
            }
        } else {
            return await sendGenerationRequest(type, generate_data);
        }
    }

    return finishGenerating().then(onSuccess, onError);

    async function onSuccess(data) {
        if (!data) return;
        let messageChunk = '';

        if (data.error) {
            generatedPromptCache = '';

            if (data?.response) {
                toastr.error(data.response, 'API Error');
            }
            throw data?.response;
        }

        //const getData = await response.json();
        let getMessage = extractMessageFromData(data);
        let title = extractTitleFromData(data);
        kobold_horde_model = title;

        const swipes = extractMultiSwipes(data, type);

        messageChunk = cleanUpMessage(getMessage, isImpersonate, isContinue, false);

        if (isContinue) {
            getMessage = continue_mag + getMessage;
        }

        //Formating
        const displayIncomplete = type === 'quiet' && !quietToLoud;
        getMessage = cleanUpMessage(getMessage, isImpersonate, isContinue, displayIncomplete);

        if (getMessage.length > 0) {
            if (isImpersonate) {
                $('#send_textarea').val(getMessage).trigger('input');
                generatedPromptCache = '';
                await eventSource.emit(event_types.IMPERSONATE_READY, getMessage);
            }
            else if (type == 'quiet') {
                unblockGeneration();
                return getMessage;
            }
            else {
                // Without streaming we'll be having a full message on continuation. Treat it as a last chunk.
                if (originalType !== 'continue') {
                    ({ type, getMessage } = await saveReply(type, getMessage, false, title, swipes));
                }
                else {
                    ({ type, getMessage } = await saveReply('appendFinal', getMessage, false, title, swipes));
                }
            }

            if (type !== 'quiet') {
                playMessageSound();
            }
        } else {
            // If maxLoops is not passed in (e.g. first time generating), set it to MAX_GENERATION_LOOPS
            maxLoops ??= MAX_GENERATION_LOOPS;

            if (maxLoops === 0) {
                if (type !== 'quiet') {
                    throwCircuitBreakerError();
                }
                throw new Error('Generate circuit breaker interruption');
            }

            // regenerate with character speech reenforced
            // to make sure we leave on swipe type while also adding the name2 appendage
            await delay(1000);
            // The first await is for waiting for the generate to start. The second one is waiting for it to finish
            const result = await await Generate(type, { automatic_trigger, force_name2: true, quiet_prompt, skipWIAN, force_chid, maxLoops: maxLoops - 1 });
            return result;
        }

        if (power_user.auto_swipe) {
            console.debug('checking for autoswipeblacklist on non-streaming message');
            function containsBlacklistedWords(getMessage, blacklist, threshold) {
                console.debug('checking blacklisted words');
                const regex = new RegExp(`\\b(${blacklist.join('|')})\\b`, 'gi');
                const matches = getMessage.match(regex) || [];
                return matches.length >= threshold;
            }

            const generatedTextFiltered = (getMessage) => {
                if (power_user.auto_swipe_blacklist_threshold) {
                    if (containsBlacklistedWords(getMessage, power_user.auto_swipe_blacklist, power_user.auto_swipe_blacklist_threshold)) {
                        console.debug('Generated text has blacklisted words');
                        return true;
                    }
                }

                return false;
            };
            if (generatedTextFiltered(getMessage)) {
                console.debug('swiping right automatically');
                is_send_press = false;
                swipe_right();
                // TODO: do we want to resolve after an auto-swipe?
                return;
            }
        }

        console.debug('/api/chats/save called by /Generate');
        await saveChatConditional();
        unblockGeneration();
        streamingProcessor = null;

        if (type !== 'quiet') {
            triggerAutoContinue(messageChunk, isImpersonate);
        }
    }

    function onError(exception) {
        if (typeof exception?.error?.message === 'string') {
            toastr.error(exception.error.message, 'Error', { timeOut: 10000, extendedTimeOut: 20000 });
        }

        unblockGeneration();
        console.log(exception);
        streamingProcessor = null;
        throw exception;
    }
}


class StreamingProcessor {
    constructor(type, force_name2, timeStarted, messageAlreadyGenerated) {
        this.result = '';
        this.messageId = -1;
        this.type = type;
        this.force_name2 = force_name2;
        this.isStopped = false;
        this.isFinished = false;
        this.generator = this.nullStreamingGeneration;
        this.abortController = new AbortController();
        this.firstMessageText = '...';
        this.timeStarted = timeStarted;
        this.messageAlreadyGenerated = messageAlreadyGenerated;
        this.swipes = [];
    }

    showMessageButtons(messageId) {
        if (messageId == -1) {
            return;
        }

        showStopButton();
        $(`#chat .mes[mesid="${messageId}"] .mes_buttons`).css({ 'display': 'none' });
    }

    hideMessageButtons(messageId) {
        if (messageId == -1) {
            return;
        }

        hideStopButton();
        $(`#chat .mes[mesid="${messageId}"] .mes_buttons`).css({ 'display': 'flex' });
    }

    async onStartStreaming(text) {
        let messageId = -1;

        if (this.type == 'impersonate') {
            $('#send_textarea').val('').trigger('input');
        }
        else {
            await saveReply(this.type, text, true);
            messageId = count_view_mes - 1;
            this.showMessageButtons(messageId);
        }

        hideSwipeButtons();
        scrollChatToBottom();
        return messageId;
    }

    onProgressStreaming(messageId, text, isFinal) {
        const isImpersonate = this.type == 'impersonate';
        const isContinue = this.type == 'continue';

        if (!isImpersonate && !isContinue && Array.isArray(this.swipes) && this.swipes.length > 0) {
            for (let i = 0; i < this.swipes.length; i++) {
                this.swipes[i] = cleanUpMessage(this.swipes[i], false, false, true, this.stoppingStrings);
            }
        }

        let processedText = cleanUpMessage(text, isImpersonate, isContinue, !isFinal, this.stoppingStrings);

        // Predict unbalanced asterisks / quotes during streaming
        const charsToBalance = ['*', '"', '```'];
        for (const char of charsToBalance) {
            if (!isFinal && isOdd(countOccurrences(processedText, char))) {
                // Add character at the end to balance it
                const separator = char.length > 1 ? '\n' : '';
                processedText = processedText.trimEnd() + separator + char;
            }
        }

        if (isImpersonate) {
            $('#send_textarea').val(processedText).trigger('input');
        }
        else {
            let currentTime = new Date();
            // Don't waste time calculating token count for streaming
            let currentTokenCount = isFinal && power_user.message_token_count_enabled ? getTokenCount(processedText, 0) : 0;
            const timePassed = formatGenerationTimer(this.timeStarted, currentTime, currentTokenCount);
            chat[messageId]['mes'] = processedText;
            chat[messageId]['gen_started'] = this.timeStarted;
            chat[messageId]['gen_finished'] = currentTime;

            if (currentTokenCount) {
                if (!chat[messageId]['extra']) {
                    chat[messageId]['extra'] = {};
                }

                chat[messageId]['extra']['token_count'] = currentTokenCount;
                const tokenCounter = $(`#chat .mes[mesid="${messageId}"] .tokenCounterDisplay`);
                tokenCounter.text(`${currentTokenCount}t`);
            }

            if ((this.type == 'swipe' || this.type === 'continue') && Array.isArray(chat[messageId]['swipes'])) {
                chat[messageId]['swipes'][chat[messageId]['swipe_id']] = processedText;
                chat[messageId]['swipe_info'][chat[messageId]['swipe_id']] = { 'send_date': chat[messageId]['send_date'], 'gen_started': chat[messageId]['gen_started'], 'gen_finished': chat[messageId]['gen_finished'], 'extra': JSON.parse(JSON.stringify(chat[messageId]['extra'])) };
            }

            let formattedText = messageFormatting(
                processedText,
                chat[messageId].name,
                chat[messageId].is_system,
                chat[messageId].is_user,
            );
            const mesText = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
            mesText.html(formattedText);
            $(`#chat .mes[mesid="${messageId}"] .mes_timer`).text(timePassed.timerValue).attr('title', timePassed.timerTitle);
            this.setFirstSwipe(messageId);
        }

        if (!scrollLock) {
            scrollChatToBottom();
        }
    }

    async onFinishStreaming(messageId, text) {
        this.hideMessageButtons(this.messageId);
        this.onProgressStreaming(messageId, text, true);
        addCopyToCodeBlocks($(`#chat .mes[mesid="${messageId}"]`));

        if (Array.isArray(this.swipes) && this.swipes.length > 0) {
            const message = chat[messageId];
            const swipeInfo = {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: structuredClone(message.extra),
            };
            const swipeInfoArray = [];
            swipeInfoArray.length = this.swipes.length;
            swipeInfoArray.fill(swipeInfo);
            chat[messageId].swipes.push(...this.swipes);
            chat[messageId].swipe_info.push(...swipeInfoArray);
        }

        if (this.type !== 'impersonate') {
            await eventSource.emit(event_types.MESSAGE_RECEIVED, this.messageId);
            await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, this.messageId);
        } else {
            await eventSource.emit(event_types.IMPERSONATE_READY, text);
        }

        await saveChatConditional();
        activateSendButtons();
        showSwipeButtons();
        setGenerationProgress(0);
        generatedPromptCache = '';

        //console.log("Generated text size:", text.length, text)

        if (power_user.auto_swipe) {
            function containsBlacklistedWords(str, blacklist, threshold) {
                const regex = new RegExp(`\\b(${blacklist.join('|')})\\b`, 'gi');
                const matches = str.match(regex) || [];
                return matches.length >= threshold;
            }

            const generatedTextFiltered = (text) => {
                if (text) {
                    if (power_user.auto_swipe_minimum_length) {
                        if (text.length < power_user.auto_swipe_minimum_length && text.length !== 0) {
                            console.log('Generated text size too small');
                            return true;
                        }
                    }
                    if (power_user.auto_swipe_blacklist_threshold) {
                        if (containsBlacklistedWords(text, power_user.auto_swipe_blacklist, power_user.auto_swipe_blacklist_threshold)) {
                            console.log('Generated text has blacklisted words');
                            return true;
                        }
                    }
                }
                return false;
            };

            if (generatedTextFiltered(text)) {
                swipe_right();
                return;
            }
        }
        playMessageSound();
    }

    onErrorStreaming() {
        this.abortController.abort();
        this.isStopped = true;

        this.hideMessageButtons(this.messageId);
        $('#send_textarea').removeAttr('disabled');
        is_send_press = false;
        activateSendButtons();
        setGenerationProgress(0);
        showSwipeButtons();
    }

    setFirstSwipe(messageId) {
        if (this.type !== 'swipe' && this.type !== 'impersonate') {
            if (Array.isArray(chat[messageId]['swipes']) && chat[messageId]['swipes'].length === 1 && chat[messageId]['swipe_id'] === 0) {
                chat[messageId]['swipes'][0] = chat[messageId]['mes'];
                chat[messageId]['swipe_info'][0] = { 'send_date': chat[messageId]['send_date'], 'gen_started': chat[messageId]['gen_started'], 'gen_finished': chat[messageId]['gen_finished'], 'extra': JSON.parse(JSON.stringify(chat[messageId]['extra'])) };
            }
        }
    }

    onStopStreaming() {
        this.onErrorStreaming();
    }

    *nullStreamingGeneration() {
        throw new Error('Generation function for streaming is not hooked up');
    }

    async generate() {
        if (this.messageId == -1) {
            this.messageId = await this.onStartStreaming(this.firstMessageText);
            await delay(1); // delay for message to be rendered
            scrollLock = false;
        }

        // Stopping strings are expensive to calculate, especially with macros enabled. To remove stopping strings
        // when streaming, we cache the result of getStoppingStrings instead of calling it once per token.
        const isImpersonate = this.type == 'impersonate';
        const isContinue = this.type == 'continue';
        this.stoppingStrings = getStoppingStrings(isImpersonate, isContinue);

        try {
            const sw = new Stopwatch(1000 / power_user.streaming_fps);
            const timestamps = [];
            for await (const { text, swipes } of this.generator()) {
                timestamps.push(Date.now());
                if (this.isStopped) {
                    return;
                }

                this.result = text;
                this.swipes = swipes;
                await sw.tick(() => this.onProgressStreaming(this.messageId, this.messageAlreadyGenerated + text));
            }
            const seconds = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
            console.warn(`Stream stats: ${timestamps.length} tokens, ${seconds.toFixed(2)} seconds, rate: ${Number(timestamps.length / seconds).toFixed(2)} TPS`);
        }
        catch (err) {
            console.error(err);
            this.onErrorStreaming();
            return;
        }

        this.isFinished = true;
        return this.result;
    }
}
