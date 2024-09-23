import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import newVideos from './mongodb.js';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { exec } from 'child_process'; // For executing FFmpeg commands

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Firebase
const firebaseConfig = 
{
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const storage = getStorage(firebaseApp);

// Serve static files from "public" directory
app.use(express.static(path.join(path.resolve(), 'public')));
app.use(express.json());

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' }); // Temporary storage in local uploads directory

// Handle video upload
app.post('/upload-video', upload.single('videoFile'), async (req, res) => {
    try {
        const { title, description } = req.body;
        if (!title || !description || !req.file) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Upload file to Firebase Storage
        const filePath = req.file.path; // Local file path
        const storageRef = ref(storage, `uploads/${req.file.filename}`); // Reference in Firebase Storage

        // Read file and upload
        const fileData = fs.readFileSync(filePath);
        await uploadBytes(storageRef, fileData);

        // Get the download URL for the video
        const videoPath = await getDownloadURL(storageRef);

        // Generate thumbnail using FFmpeg
        const thumbnailPath = `uploads/${req.file.filename}-thumbnail.png`;
        const ffmpegCommand = `ffmpeg -i ${filePath} -ss 00:00:01.000 -vframes 1 ${thumbnailPath}`;

        exec(ffmpegCommand, async (error) => {
            if (error) {
                console.error('Error generating thumbnail:', error);
                return res.status(500).json({ error: 'Failed to generate thumbnail' });
            }

            try {
                // Upload the thumbnail to Firebase Storage
                const thumbnailStorageRef = ref(storage, `thumbnails/${req.file.filename}.png`);
                const thumbnailData = fs.readFileSync(thumbnailPath);
                await uploadBytes(thumbnailStorageRef, thumbnailData);

                // Get the download URL for the thumbnail
                const thumbnailUrl = await getDownloadURL(thumbnailStorageRef);

                // Save video info and thumbnail URL to MongoDB
                await newVideos.insertMany({ title, description, videoPath, thumbnailUrl });

                // Remove the files from local storage after successful upload
                fs.unlinkSync(filePath);
                fs.unlinkSync(thumbnailPath);

                res.json({ message: 'Video and thumbnail uploaded successfully!', videoPath, thumbnailUrl });
            } catch (thumbnailError) {
                console.error('Error uploading thumbnail:', thumbnailError);
                return res.status(500).json({ error: 'Failed to upload thumbnail' });
            }
        });
    } catch (error) 
    {
        console.error('Error uploading video:', error);
        res.status(500).json({ error: 'Failed to upload video' });
    }
});

app.get('/uploaded-videos', async (req, res) => 
    {
    try {
        // Fetch all videos from MongoDB
        const videos = await newVideos.find(); // Fetches all video entries

        res.json(videos);
    } catch (error) {
        console.error('Error fetching uploaded videos:', error);
        res.status(500).json({ error: 'Failed to fetch uploaded videos' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});