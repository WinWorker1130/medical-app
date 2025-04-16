// routes/files.js
const express = require('express');
const router = express.Router();
const File = require('../models/File');
const fs = require('fs').promises;
const path = require('path');
const fsSync = require('fs');

// Get files with pagination and sorting
// routes/files.js
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort || 'asc';
    const search = req.query.search;
    const dateFilter = req.query.dateFilter;
    const typeFilter = req.query.typeFilter;
    const patientName = req.query.patientName;
    const skip = (page - 1) * limit;

    // Build query object
    let query = {};

    // Patient filter
    if (patientName) {
      query.patientName = patientName;
    }

    // Search filter
    if (search) {
      query.originalName = { $regex: search, $options: 'i' };
    }

    // Date filter
    if (dateFilter) {
      const now = new Date();
      switch (dateFilter) {
        case 'today':
          query.uploadedAt = {
            $gte: new Date(now.setHours(0, 0, 0, 0)),
            $lt: new Date(now.setHours(23, 59, 59, 999))
          };
          break;
        case 'yesterday':
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          query.uploadedAt = {
            $gte: new Date(yesterday.setHours(0, 0, 0, 0)),
            $lt: new Date(yesterday.setHours(23, 59, 59, 999))
          };
          break;
        case 'last-week':
          const lastWeek = new Date(now);
          lastWeek.setDate(lastWeek.getDate() - 7);
          query.uploadedAt = { $gte: lastWeek };
          break;
        case 'last-month':
          const lastMonth = new Date(now);
          lastMonth.setDate(lastMonth.getDate() - 30);
          query.uploadedAt = { $gte: lastMonth };
          break;
      }
    }

    // Type filter
    if (typeFilter && typeFilter !== 'all') {
      query.type = typeFilter.toLowerCase();
    }

    const files = await File.find(query)
      .sort({ uploadedAt: sort })
      .skip(skip)
      .limit(limit);

    const total = await File.countDocuments(query);

    res.json({
      files: files.map(file => ({
        id: file._id,
        name: file.originalName,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type,
        uploadAt: new Date(file.uploadedAt).toLocaleString(),
        status: 'Trained',
        path: file.path,
        patientName: file.patientName,
        ocrResults: file.ocrResults,
        medicalSummary: file.medicalSummary // Include medical summary
      })),
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching files' });
  }
});

// Download file
router.get('/download/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }
    res.download(file.path);
  } catch (error) {
    res.status(500).json({ message: 'Error downloading file' });
  }
});

// Delete file
router.delete('/:id', async (req, res) => {
  try {
    await File.findByIdAndDelete(req.params.id);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting file' });
  }
});

// Rename file
router.patch('/:id', async (req, res) => {
  try {
    const file = await File.findByIdAndUpdate(
      req.params.id,
      { originalName: req.body.name },
      { new: true }
    );
    res.json(file);
  } catch (error) {
    res.status(500).json({ message: 'Error renaming file' });
  }
});

router.get('/debug', async (req, res) => {
  try {
    const files = await File.find().select('originalName ocrResults');
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching files', error: error.message });
  }
});

router.get('/debug/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    res.json({
      filename: file.originalName,
      ocrResults: file.ocrResults
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching file', error: error.message });
  }
});

router.get('/view-pdf', async (req, res) => {
  try {
    const originalFilename = req.query.filename;
    
    if (!originalFilename) {
      console.error('No filename provided');
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Get all files in uploads directory
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const files = await fs.readdir(uploadsDir);

    // Find the file that contains the original filename (ignoring timestamp)
    const actualFile = files.find(file => file.includes(originalFilename));

    if (!actualFile) {
      console.error('PDF not found for:', originalFilename);
      return res.status(404).json({ error: 'PDF not found' });
    }

    const filePath = path.join(uploadsDir, actualFile);
    console.log('Serving PDF from:', filePath);

    // Check if file exists
    if (!fsSync.existsSync(filePath)) {
      console.error('PDF file not found at:', filePath);
      return res.status(404).json({ error: 'PDF file not found' });
    }

    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${actualFile}"`);

    // Stream the file
    const fileStream = fsSync.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error serving PDF:', error);
    res.status(500).json({ error: 'Error serving PDF' });
  }
});

router.get('/timeline/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file || !file.ocrResults.timeline) {
      return res.status(404).json({ message: 'Timeline not found' });
    }
    res.json({ timeline: file.ocrResults.timeline.events });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching timeline', error: error.message });
  }
});

router.get('/:id/timeline', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file || !file.ocrResults || !file.ocrResults.textFilePath) {
      return res.status(404).json({ message: 'File or timeline not found' });
    }

    // Construct the timeline.json path from the text file path
    const timelinePath = path.join(path.dirname(file.ocrResults.textFilePath), 'timeline.json');
    
    // Read the timeline JSON file
    const timelineData = await fs.readFile(timelinePath, 'utf-8');
    const timeline = JSON.parse(timelineData);
    
    res.json(timeline);
  } catch (error) {
    console.error('Error serving timeline:', error);
    res.status(500).json({ message: 'Error fetching timeline', error: error.message });
  }
});

module.exports = router;