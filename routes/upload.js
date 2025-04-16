const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { PythonShell } = require('python-shell');
const File = require('../models/File');
const Patient = require('../models/Patient');
const { spawn } = require('child_process');

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

const processOCR = (filePath, patientName, originalFilename) => {
  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(__dirname, '..', 'python', 'ocr.py');
    
    // Sanitize the names to remove any special characters
    const sanitizedPatientName = patientName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const sanitizedFilename = originalFilename.replace(" ", '_');
    // console.log(sanitizedFilename);
    

    const pythonProcess = spawn('python', [
      pythonScriptPath,
      filePath,
      sanitizedPatientName,
      sanitizedFilename
    ]);

    let dataString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      // Only log actual errors, not standard Python output
      if (data.toString().toLowerCase().includes('error')) {
        console.error(`Python Error: ${data.toString()}`);
      }
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`OCR process exited with code ${code}`));
        return;
      }
      try {
        const result = JSON.parse(dataString);
        if (result.status === 'error') {
          reject(new Error(result.message));
          return;
        }
        resolve(result);
      } catch (error) {
        reject(new Error('Failed to parse OCR results'));
      }
    });
  });
};

// Handle file upload
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const patientName = req.body.patientName;
    if (!patientName) {
      return res.status(400).json({ message: 'Patient name is required' });
    }

    // First, process OCR
    const ocrResults = await processOCR(
      req.file.path,
      patientName,
      req.file.originalname
    );

    // Then, generate timeline using the OCR text file
    const timelineResults = await new Promise((resolve, reject) => {
      const sanitizedFilename = req.file.originalname.replace(" ", '_');

      const pythonProcess = spawn('python', [
        path.join(__dirname, '..', 'python', 'generate_timeline.py'),
        ocrResults.text_file
      ]);
      let timelineData = '';

      pythonProcess.stdout.on('data', (data) => {
        timelineData += data.toString();
        // console.log('Timeline stdout:', data.toString());
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error('Timeline Error:', data.toString());
      });

      pythonProcess.on('close', (code) => {
        // if (code !== 0) {
        //   console.error(`Timeline process exited with code ${code}`);
        //   reject(new Error(`Timeline process exited with code ${code}`));
        //   return;
        // }
        try {
          const parsedData = JSON.parse(timelineData);
          console.log('Timeline results:', parsedData);
          resolve(parsedData);
        } catch (error) {
          console.error('Failed to parse timeline results:', error);
          reject(new Error('Failed to parse timeline results'));
        }
      });
    });

    let patient = await Patient.findOne({ name: patientName });
    if (!patient) {
      patient = new Patient({ name: patientName });
      await patient.save();
    }

    const newFile = new File({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      type: path.extname(req.file.originalname).slice(1),
      path: req.file.path,
      patientName: patientName,
      ocrResults: {
        textFilePath: ocrResults.text_file,
        processedPdfPath: ocrResults.processed_pdf,
        timeline: {
          path: timelineResults.timeline_path
        }
      },
      timeline: timelineResults.events,
      medicalSummary: ocrResults.medical_summary
    });

    const savedFile = await newFile.save();
    patient.files.push(savedFile._id);
    await patient.save();

    res.status(201).json({
      message: 'File uploaded and processed successfully',
      file: savedFile
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error processing file', error: error.message });
  }
});

module.exports = router;