import express from "express";
import cors from "cors";
import axios, { AxiosError } from "axios";
import * as cheerio from "cheerio";
import archiver from "archiver";
import { Readable } from "stream";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

interface UserProfile {
  username: string;
  title: string;
  bio: string;
  profilePictureUrl: string;
  videos: Video[];
}

interface Video {
  id: string;
  url: string;
  thumbnail: string;
  duration: number;
}

app.post("/scrape", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const url = `https://www.snapchat.com/add/${username}`;

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const scriptContent = $("#__NEXT_DATA__").html();
    if (!scriptContent) {
      return res
        .status(404)
        .json({ message: "User not found or no content available" });
    }
    const jsonData = JSON.parse(scriptContent);
    // save the data to a file to analyze it
    fs.writeFileSync("data.json", JSON.stringify(jsonData, null, 2));
    const videos = extractVideos(jsonData);
    if (videos.length === 0) {
      return res.status(404).json({ message: "No videos found for this user" });
    }

    const userProfile: UserProfile = {
      username,
      title: jsonData.props.pageProps.userProfile.publicProfileInfo.title,
      bio: jsonData.props.pageProps.userProfile.publicProfileInfo.bio,
      profilePictureUrl:
        jsonData.props.pageProps.userProfile.publicProfileInfo
          .profilePictureUrl,
      videos: videos,
    };

    res.json(userProfile);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        return res.status(404).json({ message: "User not found" });
      }
    }
    res.status(500).json({ message: "An error occurred while scraping" });
  }
});

app.get("/download", async (req, res) => {
  try {
    const { url } = req.query;
    if (typeof url !== "string") {
      return res.status(400).json({ message: "Invalid URL" });
    }
    const response = await axios.get(url, { responseType: "stream" });
    res.setHeader("Content-Type", "video/mp4");
    response.data.pipe(res);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        return res.status(404).json({ message: "Video not found" });
      }
    }
    res
      .status(500)
      .json({ message: "An error occurred while downloading the video" });
  }
});

app.post("/download-all", async (req, res) => {
  try {
    const { videos } = req.body;
    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: "Invalid or empty video list" });
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=videos.zip");

    archive.pipe(res);

    for (const video of videos) {
      try {
        const response = await axios.get(video.url, {
          responseType: "arraybuffer",
        });
        const buffer = Buffer.from(response.data, "binary");
        archive.append(Readable.from(buffer), { name: `${video.id}.mp4` });
      } catch (error) {
        console.error(`Error downloading video ${video.id}:`);
        // Continue with the next video if one fails
      }
    }

    await archive.finalize();
  } catch (error) {
    res
      .status(500)
      .json({ error: "An error occurred while downloading all videos" });
  }
});

function extractVideos(jsonData: any): Video[] {
  const spotlightHighlights =
    jsonData.props?.pageProps?.spotlightHighlights || [];
  const spotlightMetadata =
    jsonData.props?.pageProps?.spotlightStoryMetadata || [];
  console.log(spotlightMetadata);
  return spotlightHighlights
    .map((highlight: any, index: number) => ({
      id: highlight.storyId?.value || "",
      url: highlight.snapList?.[0]?.snapUrls?.mediaUrl || "",
      thumbnail: highlight.thumbnailUrl?.value || "",
      duration: spotlightMetadata[index]?.videoMetadata?.durationMs || 0,
    }))
    .filter((video: Video) => video.id && video.url && video.thumbnail);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
