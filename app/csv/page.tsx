"use client";

import { useState, useRef, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import Papa from "papaparse";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import Link from "next/link";

interface SearchResult {
  items?: {
    pagemap?: {
      cse_image?: { src: string }[]
    }
  }[];
}

interface ProcessingStatus {
  current: number;
  total: number;
  currentItem: string;
  status: "idle" | "processing" | "downloading" | "complete" | "error";
  message: string;
  downloadUrl?: string;
}

interface ParsedRow {
  [key: string]: string;
}

export default function CsvPage() {
  const [store, setStore] = useState("TARGET");
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    current: 0,
    total: 0,
    currentItem: "",
    status: "idle",
    message: ""
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      // Reset status when a new file is selected
      setProcessingStatus({
        current: 0,
        total: 0,
        currentItem: "",
        status: "idle",
        message: ""
      });
    }
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setFile(null);
  };

  const processCSV = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingStatus({
      current: 0,
      total: 0,
      currentItem: "",
      status: "processing",
      message: "Parsing CSV file..."
    });

    // Parse CSV
    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          // Determine which column to use based on store
          let idColumnName = "";
          if (store === "TARGET") {
            idColumnName = "TCIN";
          } else if (store === "BESTBUY") {
            idColumnName = "Model";
          } else if (store === "HOMEDEPOT") {
            idColumnName = "Item Description";
          } else if (store === "LOWES") {
            idColumnName = "Model";
          }
          // Future stores can be added here with their respective column names

          if (!idColumnName) {
            throw new Error(`No column name defined for store: ${store}`);
          }

          // Filter rows that have the ID column
          const validRows = (results.data as ParsedRow[]).filter(row => 
            row[idColumnName] && row[idColumnName].toString().trim() !== ""
          );

          if (validRows.length === 0) {
            throw new Error(`No valid ${idColumnName} values found in the CSV`);
          }

          setProcessingStatus(prev => ({
            ...prev,
            total: validRows.length,
            message: `Found ${validRows.length} items to process`
          }));

          // Create zip file
          const zip = new JSZip();

          // Process each row
          for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];
            const id = row[idColumnName].toString().trim();
            
            setProcessingStatus(prev => ({
              ...prev,
              current: i + 1,
              currentItem: id,
              message: `Searching for ${store} item: ${id} (${i + 1}/${validRows.length})`
            }));

            try {
              // Build search query based on store
              let query = id;
              if (store === "TARGET") {
                query = `TARGET ${id}`;
              } else if (store === "BESTBUY") {
                query = `BestBuy ${id}`;
              } else if (store === "HOMEDEPOT") {
                query = `Home Depot ${id}`;
              } else if (store === "LOWES") {
                query = `Lowes ${id}`;
              }

              // Search for image (now with enhanced URL)
              const originalImageUrl = await searchForImage(query);
              
              if (originalImageUrl) {
                setProcessingStatus(prev => ({
                  ...prev,
                  status: "downloading",
                  message: `Downloading image for ${id} (${i + 1}/${validRows.length})`
                }));

                try {
                  // Use our proxy API instead of direct fetch
                  const encodedImageUrl = encodeURIComponent(originalImageUrl);
                  const proxyUrl = `/api/image-proxy?url=${encodedImageUrl}`;
                  
                  // Direct download of the image via our proxy
                  const response = await fetch(proxyUrl);
                  
                  if (!response.ok) {
                    throw new Error(`Failed to download image: ${response.status}`);
                  }
                  
                  const imageBlob = await response.blob();
                  
                  // Make sure the blob is actually an image
                  if (!imageBlob.type.startsWith('image/')) {
                    console.warn(`Warning: Downloaded content for ${id} might not be an image. Content type: ${imageBlob.type}`);
                  }

                  // Create a formatted filename using multiple columns
                  let model = row["Model"] || "";
                  let item_desc = row["Item Description"] || "";
                  let unit_retail = row["Unit Retail"] || "";
                  let brand = row["Brand"] || row["Manufacturer"] || "";
                  
                  // Replace any underscores with spaces in each field
                  model = model.toString().replace(/_/g, " ");
                  item_desc = item_desc.toString().replace(/_/g, " ");
                  unit_retail = unit_retail.toString().replace(/_/g, " ");
                  brand = brand.toString().replace(/_/g, " ");
                  
                  // Create the filename with the new format
                  const filename = `${model}_${item_desc}_${unit_retail}_${brand}.webp`;
                  
                  // Add to zip root
                  zip.file(filename, imageBlob);
                  
                  console.log(`Successfully added image for ${id} to zip (${imageBlob.size} bytes)`);
                } catch (downloadError) {
                  console.error(`Error downloading image for ${id}:`, downloadError);
                }
              } else {
                console.log(`No image found for ${id}`);
              }
            } catch (error) {
              console.error(`Error processing item ${id}:`, error);
              // Continue with next item even if this one fails
            }
          }

          // Generate zip file
          setProcessingStatus(prev => ({
            ...prev,
            status: "downloading",
            message: "Generating ZIP file..."
          }));

          const zipBlob = await zip.generateAsync({ type: "blob" });
          const zipUrl = URL.createObjectURL(zipBlob);

          setProcessingStatus({
            current: validRows.length,
            total: validRows.length,
            currentItem: "",
            status: "complete",
            message: "Processing complete! Your download is ready.",
            downloadUrl: zipUrl
          });
          
        } catch (error) {
          setProcessingStatus({
            current: 0,
            total: 0,
            currentItem: "",
            status: "error",
            message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
          });
        } finally {
          setIsProcessing(false);
        }
      },
      error: (error: Error) => {
        setProcessingStatus({
          current: 0,
          total: 0,
          currentItem: "",
          status: "error",
          message: `CSV parsing error: ${error.message}`
        });
        setIsProcessing(false);
      }
    });
  };

  const searchForImage = async (query: string): Promise<string | null> => {
    // Encode the query for URL
    const encodedQuery = encodeURIComponent(query);
    
    // API key and CX from main page
    const apiKey = "AIzaSyDHZ5_9TFjLIbuAAKoQXCmq9_aRia9lmsc"; 
    const cx = "52ea300a2b37a439e";
    
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}`
    );
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    const data: SearchResult = await response.json();
    
    // Different image search strategy based on store
    if (store === "TARGET") {
      // Look for the first cse_image with source that starts with "https://target.scene7.com"
      const targetImage = data.items?.find(item => 
        item.pagemap?.cse_image?.[0]?.src.startsWith("https://target.scene7.com")
      )?.pagemap?.cse_image?.[0]?.src;
      
      // Append quality parameters to the URL if an image is found
      if (targetImage) {
        return `${targetImage}?qlt=65&fmt=webp&hei=1200&wid=1200`;
      }
    } else if (store === "HOMEDEPOT") {
      // First try to find an image with URL starting with "https://images.thdstatic"
      const homeDepotImage = data.items?.find(item => 
        item.pagemap?.cse_image?.[0]?.src.startsWith("https://images.thdstatic")
      )?.pagemap?.cse_image?.[0]?.src;
      
      // If found, return it
      if (homeDepotImage) {
        return homeDepotImage;
      }
      
      // If not found, use the first available image
      const firstImage = data.items?.[0]?.pagemap?.cse_image?.[0]?.src;
      if (firstImage) {
        return firstImage;
      }
    } else if (store === "BESTBUY") {
      // For BestBuy, just get the first image without any URL filtering
      const bestBuyImage = data.items?.[0]?.pagemap?.cse_image?.[0]?.src;
      
      // Return the image URL as is without adding parameters
      if (bestBuyImage) {
        return bestBuyImage;
      }
    } else if (store === "LOWES") {
      // Look for the first cse_image with source that starts with "https://mobileimages.lowes.com/productimages/"
      const lowesImage = data.items?.find(item => 
        item.pagemap?.cse_image?.[0]?.src.startsWith("https://mobileimages.lowes.com/productimages/")
      )?.pagemap?.cse_image?.[0]?.src;
      
      if (lowesImage) {
        // Check if the URL ends with size=... and replace it with size=full
        if (lowesImage.match(/size=[^&]+$/)) {
          return lowesImage.replace(/size=[^&]+$/, 'size=full');
        }
        return lowesImage;
      }
      
      // If not found with the specific URL pattern, use the first image
      const firstImage = data.items?.[0]?.pagemap?.cse_image?.[0]?.src;
      if (firstImage) {
        // Also check the fallback image for size parameter
        if (firstImage.startsWith("https://mobileimages.lowes.com/productimages/") && firstImage.match(/size=[^&]+$/)) {
          return firstImage.replace(/size=[^&]+$/, 'size=full');
        }
        return firstImage;
      }
    }
    
    return null;
  };

  const downloadZip = () => {
    if (processingStatus.downloadUrl) {
      saveAs(processingStatus.downloadUrl, `${store.toLowerCase()}_images.zip`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-8">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">CSV Image Downloader</h1>
          <Link href="/" className="text-blue-500 hover:underline">
            Back to Search
          </Link>
        </div>
        
        <div className="flex flex-col gap-4 p-6 border rounded-lg bg-gray-50">
          <div className="space-y-2">
            <p className="text-sm font-medium">Store</p>
            <Select value={store} onValueChange={setStore} disabled={isProcessing}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TARGET">TARGET</SelectItem>
                <SelectItem value="BESTBUY">BEST BUY</SelectItem>
                <SelectItem value="HOMEDEPOT">HOME DEPOT</SelectItem>
                <SelectItem value="LOWES">LOWES</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload CSV File</p>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={isProcessing}
              className="cursor-pointer"
            />
            <p className="text-xs text-gray-500">
              {store === "TARGET" && "Your CSV should include a column named 'TCIN' with Target product IDs."}
              {store === "BESTBUY" && "Your CSV should include a column named 'Model' with Best Buy model numbers."}
              {store === "HOMEDEPOT" && "Your CSV should include a column named 'Item Description' with Home Depot product descriptions."}
              {store === "LOWES" && "Your CSV should include a column named 'Model' with Lowes model numbers."}
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={processCSV} 
              disabled={!file || isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Process CSV and Download Images"}
            </Button>
            
            {file && !isProcessing && (
              <Button 
                variant="outline" 
                onClick={resetFileInput} 
                className="flex-shrink-0"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        
        {/* Status and Progress */}
        {processingStatus.status !== "idle" && (
          <div className={`p-4 border rounded-lg ${
            processingStatus.status === "error" 
              ? "bg-red-50 border-red-200" 
              : processingStatus.status === "complete"
                ? "bg-green-50 border-green-200"
                : "bg-blue-50 border-blue-200"
          }`}>
            <div className="flex flex-col gap-2">
              <p className="font-medium">
                {processingStatus.status === "error" ? "Error" : "Status"}
              </p>
              
              <p>{processingStatus.message}</p>
              
              {(processingStatus.status === "processing" || processingStatus.status === "downloading") && (
                <div className="space-y-2">
                  <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${(processingStatus.current / processingStatus.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-right">
                    {processingStatus.current} of {processingStatus.total} ({Math.round((processingStatus.current / processingStatus.total) * 100)}%)
                  </p>
                </div>
              )}
              
              {processingStatus.status === "complete" && processingStatus.downloadUrl && (
                <Button onClick={downloadZip} className="mt-2">
                  Download ZIP File
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
} 