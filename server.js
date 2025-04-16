require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const uploadRoutes = require("./routes/upload");
const patientsRoutes = require('./routes/patients');
const chatRoutes = require('./routes/chat');
const filesRoutes = require("./routes/files");
const path = require('path');
const fs = require("fs");

// Initialize Express app
const app = express();

// Set the port, either from the environment variable or default to 4000
const port = process.env.PORT || 4000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads directory if it doesn't exist
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

// Routes
app.use("/api/upload", uploadRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/chat', chatRoutes);
app.use("/api/files", filesRoutes);

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Dynamic file endpoint
app.get('/api/files/:patient/:fileName/timeline.json', async (req, res) => {
  try {
    const { patient, fileName } = req.params;
    const timelinePath = path.join(__dirname, 'pdf', 'text', patient, fileName, 'timeline.json');
    console.log(fileName);
    

    if (fs.existsSync(timelinePath)) {
      const timelineData = await fs.promises.readFile(timelinePath, 'utf8');
      res.json(JSON.parse(timelineData));
    } else {
      res.status(404).json({ error: 'Timeline not found' });
    }
  } catch (error) {
    console.error('Error reading timeline:', error);
    res.status(500).json({ error: 'Error reading timeline data' });
  }
});

app.get('/api/files/:patient/timeline.json', async (req, res) => {
  try {
    const { patient, fileName } = req.params;
    const timelinePath = path.join(__dirname, 'pdf', 'text', patient, 'timeline.json');
    console.log(fileName);
    

    if (fs.existsSync(timelinePath)) {
      const timelineData = await fs.promises.readFile(timelinePath, 'utf8');
      res.json(JSON.parse(timelineData));
    } else {
      res.status(404).json({ error: 'Timeline not found' });
    }
  } catch (error) {
    console.error('Error reading timeline:', error);
    res.status(500).json({ error: 'Error reading timeline data' });
  }
});

// Start the server on the specified port
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Export the app for Vercel
module.exports = app;
