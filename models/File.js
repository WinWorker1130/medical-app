const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  path: {
    type: String,
    required: true
  },
  patientName: {
    type: String,
    required: true
  },
  ocrResults: {
    textFilePath: String,
    processedPdfPath: String,
    pages: [{
      pageNumber: Number,
      content: String
    }],
    totalPages: Number,
    patientFolder: String,
    fileFolder: String,
    timeline: {
      path: String
    }
  },
  medicalSummary: {
    type: String
  }
});

module.exports = mongoose.model('File', fileSchema);