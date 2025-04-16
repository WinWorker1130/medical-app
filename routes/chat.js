// routes/chat.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { Anthropic } = require('@anthropic-ai/sdk');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

function formatConfidenceScore(score) {
  return Math.round(score * 10) / 10;
}

async function getAllVectorStores(patientPath) {
  try {
    const fileFolders = await fs.readdir(patientPath);
    let vectorStores = [];

    for (const fileFolder of fileFolders) {
      const filePath = path.join(patientPath, fileFolder);
      const vectorsPath = path.join(filePath, 'vectors');

      try {
        const stats = await fs.stat(vectorsPath);
        if (stats.isDirectory()) {
          const files = await fs.readdir(vectorsPath);
          if (files.includes('patient_vectors.faiss') && files.includes('patient_vectors.pkl')) {
            vectorStores.push(vectorsPath);
          }
        }
      } catch (error) {
        console.log(`No vectors found in ${vectorsPath}`);
        continue;
      }
    }

    return vectorStores;
  } catch (error) {
    console.error('Error getting vector stores:', error);
    return [];
  }
}

async function loadFaissVectorStore(vectorsPath, embeddings) {
  try {
    const faissPath = path.join(vectorsPath, 'patient_vectors.faiss');
    const pklPath = path.join(vectorsPath, 'patient_vectors.pkl');

    await Promise.all([
      fs.access(faissPath),
      fs.access(pklPath)
    ]);

    console.log('Found vector files:', {
      faiss: faissPath,
      pkl: pklPath
    });

    const store = await FaissStore.load(
      vectorsPath,
      embeddings,
      { filename: 'patient_vectors' }
    );

    return store;
  } catch (error) {
    console.error(`Error loading vector store from ${vectorsPath}:`, error);
    return null;
  }
}

async function getTextContent(patientPath, fileName) {
  try {
    // List all directories in the patient's folder
    const directories = await fs.readdir(patientPath);
    
    for (const dir of directories) {
      const dirPath = patientPath;
      const stats = await fs.stat(dirPath);
      
      if (stats.isDirectory()) {
        // Read files in the directory
        const files = await fs.readdir(dirPath);
        // Find the most recent .txt file
        const textFiles = files.filter(f => f.endsWith('.txt'));
        
        if (textFiles.length > 0) {
          // Sort by timestamp in filename (assuming format: name_YYYYMMDD_HHMMSS.txt)
          const mostRecentFile = textFiles.sort().reverse()[0];
          const filePath = path.join(dirPath, mostRecentFile);
          
          console.log('Reading text file:', filePath);
          const content = await fs.readFile(filePath, 'utf-8');
          return {
            content,
            filePath,
            fileName: dir // Use the directory name as the file name
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error reading text file:', error);
    return null;
  }
}

async function findRelevantPages(text, vectorStores, embeddings) {
  const pageReferences = new Set();
  let relevantDocs = [];

  for (const vectorStorePath of vectorStores) {
    const vectorStore = await loadFaissVectorStore(vectorStorePath, embeddings);
    if (vectorStore) {
      const docs = await vectorStore.similaritySearch(text, 3);
      relevantDocs.push(...docs);
    }
  }

  // Sort by similarity and get unique pages
  relevantDocs.forEach(doc => {
    if (doc.metadata?.pageNumber) {
      pageReferences.add(doc.metadata.pageNumber);
    }
  });

  return Array.from(pageReferences).sort((a, b) => a - b);
}


router.post('/', async (req, res) => {
  try {
    const { message, patientName } = req.body;
    const patientPath = path.join(__dirname, '..', 'pdf', 'text', patientName);
    console.log('Looking for documents in:', patientPath);

    // Get text content first
    const textContent = await getTextContent(patientPath, '');
    if (!textContent) {
      console.error('No text content found');
      return res.status(404).json({
        error: 'No documents found for this patient'
      });
    }

    console.log('Found text content in:', textContent.filePath);

    // Parse the content to extract page-specific information
    const pageContents = [];
    let currentPage = 1;
    let currentContent = [];
    
    const lines = textContent.content.split('\n');
    for (const line of lines) {
      if (line.startsWith('<<<PAGE_')) {
        if (currentContent.length > 0) {
          pageContents.push({
            pageNumber: currentPage,
            content: currentContent.join('\n')
          });
        }
        currentContent = [];
        currentPage = parseInt(line.replace('<<<PAGE_', '').replace('>>>', ''));
      } else if (!line.startsWith('<<<END_PAGE_')) {
        currentContent.push(line);
      }
    }
    
    if (currentContent.length > 0) {
      pageContents.push({
        pageNumber: currentPage,
        content: currentContent.join('\n')
      });
    }

    // Create context with page numbers
    const context = pageContents
      .map(page => `[Page ${page.pageNumber}]\n${page.content}`)
      .join('\n\n');

    // Update system prompt
    const systemPrompt = `You are a medical document analysis assistant for ${patientName}. 
    Answer questions based on the provided medical documents.
    Format your responses with:
    1. A confidence score out of 10 at the top: [Confidence: X/10]
    2. A summary of key points with page numbers as badges
    When citing information, always reference the specific page number where the information was found.
    Use the exact page numbers provided in the context.
    Format page references as badges using numbers in parentheses, e.g., (45) for page 45.`;

    const response = await anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 4000,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Question: ${message}`
          // content: `Context:\n${context}\n\nQuestion: ${message}`
        }
      ]
    });

    // Process the response
    let formattedContent = response.content[0].text;
    
    // Extract confidence score
    const confidenceMatch = formattedContent.match(/\[Confidence:\s*(\d+(?:\.\d+)?)\/10\]/);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : null;
    
    // Format page numbers as badges
    formattedContent = formattedContent.replace(/\((\d+)\)/g, (match, pageNum) => {
      return `<span class="page-badge" data-page="${pageNum}">${pageNum}</span>`;
    });

    const processedResponse = {
      content: formattedContent,
      confidence,
      fileName: textContent.fileName // Add this line to include the filename
    };

    res.json(processedResponse);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Error processing chat request' });
  }
});

function formatMessage(message) {
  function convertReferences(text) {
    // Handle both document references and page numbers
    const docRefs = {};
    const docPattern = /\[Doc\.\s*(\d+)(?:,\s*p\.(\d+))?\]/g;
    let match;
    
    // First pass: collect document references
    while ((match = docPattern.exec(text)) !== null) {
      const docNum = match[1];
      const pageNum = match[2] || '1';
      const fullMatch = match[0];
      docRefs[fullMatch] = {
        doc: docNum,
        page: pageNum
      };
    }

    // Second pass: handle page references in parentheses
    text = text.replace(/\((\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)\)/g, (match, pages, offset) => {
      // Get the text to highlight
      const textBeforeCitation = text.substring(0, offset);
      const prevPeriod = textBeforeCitation.lastIndexOf('.');
      const nextPeriod = text.indexOf('.', offset);
      let currentSentence = text.substring(prevPeriod + 1, nextPeriod > -1 ? nextPeriod : undefined).trim();
      currentSentence = currentSentence.replace(/\(\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*\)/g, '').trim();

      // Split pages string into individual references
      const pageRefs = pages.split(/,\s*/);

      // Create badge with reference and highlight
      return pageRefs.map(pageRef => {
        const pageNums = pageRef.trim().split('-');
        if (pageNums.length === 1) {
          return `<span class="reference-badge" data-doc="1" data-page="${pageNums[0]}" data-highlight="${encodeURIComponent(currentSentence)}">${pageNums[0]}</span>`;
        } else {
          return `<span class="reference-badge" data-doc="1" data-page="${pageNums[0]}" data-highlight="${encodeURIComponent(currentSentence)}" title="Range: ${pageRef}">${pageNums[0]}</span>`;
        }
      }).join(' ');
    });

    return text;
  }

  return convertReferences(message);
}

module.exports = router;