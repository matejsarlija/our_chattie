// chat-service.js (Fixed version)
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
    HumanMessage,
    SystemMessage,
    AIMessage,
} = require("@langchain/core/messages");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const path = require("path");

// Debug API key loading
const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable is not set");
}
//console.log('API Key loaded successfully, length:', API_KEY.length);

const fileManager = new GoogleAIFileManager(API_KEY);

// Initialize the chat model
const chatModel = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    apiKey: API_KEY,
});

// Helper function to upload file (same as working version)
async function uploadFileToGoogleAI(filePath, originalFilename) {
    try {
        const mimeType =
            path.extname(filePath).toLowerCase() === ".pdf"
                ? "application/pdf"
                : `image/${path.extname(filePath).substring(1).toLowerCase()}`;

        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: originalFilename || path.basename(filePath),
        });

        console.log(
            `Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri}`,
        );

        let file = await fileManager.getFile(uploadResult.file.name);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 3000));
            file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === "FAILED") {
            throw new Error("File processing failed.");
        }

        return {
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType,
        };
    } catch (error) {
        console.error("Error uploading file to Google AI:", error);
        throw error;
    }
}

// Convert message format from your app to LangChain format
function convertMessagesToLangChain(messages, fileInfo = null) {
    const systemMessage = new SystemMessage(
        "You are a helpful legal assistant that excels at being factual, while also being kind and formal. " +
        "Depending on the user inquiry, you can be informative beyond the immediate question. " +
        "You frequently work with the elderly in need of free legal advice. " +
        "You only provide answers in Croatian.",
    );

    const langchainMessages = [systemMessage];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        console.log(`Processing message ${i}:`, {
            role: msg?.role,
            hasContent: !!msg?.content,
            hasParts: !!msg?.parts,
            contentPreview: (
                msg?.content ||
                msg?.parts?.[0]?.text ||
                ""
            ).substring(0, 50),
        });

        if (!msg || !msg.role) {
            console.warn(`Skipping invalid message at index ${i}:`, msg);
            continue;
        }

        // Extract text content - support both formats from your working version
        let textContent = "";
        if (msg.content) {
            // Format: { role: 'user', content: 'text' }
            textContent = msg.content;
        } else if (
            msg.parts &&
            Array.isArray(msg.parts) &&
            msg.parts.length > 0 &&
            msg.parts[0]?.text
        ) {
            // Format: { role: 'user', parts: [{ text: 'text' }] }
            textContent = msg.parts[0].text;
        } else {
            console.warn(
                `No valid content found for message at index ${i}:`,
                msg,
            );
            continue;
        }

        if (msg.role === "user") {
            let content;

            if (fileInfo && i === messages.length - 1) {
                // Determine part type based on mimeType
                const part = fileInfo.mimeType.startsWith("image/")
                    ? {
                        type: "image_url",
                        image_url: fileInfo.fileUri,
                    }
                    : {
                        type: "media",
                        fileUri: fileInfo.fileUri,
                        mimeType: fileInfo.mimeType,
                    };

                content = [
                    { type: "text", text: textContent },
                    part
                ];
            } else {
                content = textContent;
            }

            langchainMessages.push(new HumanMessage(content));
        } else if (msg.role === "model" || msg.role === "assistant") {
            if (textContent) {
                langchainMessages.push(new AIMessage(textContent));
            }
        }
    }

    return langchainMessages;
}

// Main chat handler
async function handleChatMessage({ messages, filePath, originalFilename }) {
    console.log("handleChatMessage called with:", {
        messagesType: typeof messages,
        messagesLength: messages?.length,
        firstMessage: messages?.[0],
        hasFilePath: !!filePath,
    });

    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new Error("Messages array is required and must not be empty");
    }

    let fileInfo = null;

    // Handle file upload if present
    if (filePath && originalFilename) {
        try {
            const uploadResult = await uploadFileToGoogleAI(
                filePath,
                originalFilename,
            );
            fileInfo = {
                ...uploadResult,
                originalFilename,
            };
            console.log("File uploaded successfully:", fileInfo);
        } catch (error) {
            console.error("File upload failed:", error);
            // Continue without file attachment
        }
    }

    // Convert messages to LangChain format
    const langchainMessages = convertMessagesToLangChain(messages, fileInfo);

    console.log("Converted messages:", langchainMessages.length);

    // Get streaming response
    const stream = await chatModel.stream(langchainMessages);

    return { stream };
}

// Document editing handler for specialized legal text modification
async function handleDocumentEdit({ content, instruction, context }) {
    console.log("handleDocumentEdit called with instruction:", instruction);

    const systemMessage = new SystemMessage(
        "You are a professional Croatian legal text editor and assistant. " +
        "Your task is to modify, enhance, or refine legal text according to specific user instructions. " +
        "Guidelines:\n" +
        "1. Always respond in Croatian.\n" +
        "2. Maintain a formal, legal tone appropriate for Croatian courts and administration.\n" +
        "3. When providing legal references, use the following format: <citation label='Name of Law/Act' url='Link if known' confidence='high/medium/low'></citation>.\n" +
        "4. If the user asks to 'simplify', maintain accuracy while making it accessible.\n" +
        "5. If the user asks to 'formalize', use precise Croatian legal terminology (e.g., 'podnesak', 'ovršni ispravak', 'prijedlog za ovrhu')."
    );

    const prompt = `INSTRUCTION: ${instruction}\n\nTEXT TO EDIT:\n${content}\n\nProvide only the edited text below:`;

    const langchainMessages = [
        systemMessage,
        new HumanMessage(prompt)
    ];

    // Get streaming response
    const stream = await chatModel.stream(langchainMessages);

    return { stream };
}

module.exports = { handleChatMessage, handleDocumentEdit };
