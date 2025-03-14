"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import Link from "next/link";

interface SearchResult {
  items?: {
    pagemap?: {
      cse_image?: { src: string }[]
    }
  }[];
}

export default function Home() {
  const [searchTerm, setSearchTerm] = useState("");
  const [store, setStore] = useState("TARGET");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError("Please enter a search term");
      return;
    }

    setIsLoading(true);
    setError(null);
    setImageUrl(null);

    try {
      // Modify the query based on selected store
      let query = searchTerm;
      if (store === "TARGET") {
        query = `target ${searchTerm}`;
      } else if (store === "BESTBUY") {
        query = `BestBuy ${searchTerm}`;
      } else if (store === "HOMEDEPOT") {
        query = `Home Depot ${searchTerm}`;
      }
      
      // Encode the query for URL
      const encodedQuery = encodeURIComponent(query);
      
      // Replace with your actual API key and CX
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      const cx = process.env.NEXT_PUBLIC_GOOGLE_CX;
      
      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}`
      );
      
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      const data: SearchResult = await response.json();
      
      // Look for the first cse_image with source that starts with "https://target.scene7.com" for TARGET
      // For Home Depot, look for URLs starting with "https://images.thdstatic"
      // For BestBuy, use any cse_image
      let foundImage = null;
      if (store === "TARGET") {
        foundImage = data.items?.find(item => 
          item.pagemap?.cse_image?.[0]?.src.startsWith("https://target.scene7.com")
        )?.pagemap?.cse_image?.[0]?.src;
      } else if (store === "HOMEDEPOT") {
        // First try to find an image with URL starting with "https://images.thdstatic"
        foundImage = data.items?.find(item => 
          item.pagemap?.cse_image?.[0]?.src.startsWith("https://images.thdstatic")
        )?.pagemap?.cse_image?.[0]?.src;
        
        // If not found, use the first available image
        if (!foundImage && data.items && data.items.length > 0) {
          foundImage = data.items[0]?.pagemap?.cse_image?.[0]?.src;
        }
      } else if (store === "BESTBUY") {
        // For BestBuy, use the first image found without filtering URL
        foundImage = data.items?.[0]?.pagemap?.cse_image?.[0]?.src;
      }
      
      if (foundImage) {
        // Only append quality parameters for Target images
        if (store === "TARGET") {
          // Append quality parameters to the URL
          const enhancedImageUrl = `${foundImage}?qlt=65&fmt=webp&hei=1200&wid=1200`;
          // Use our proxy API for displaying the image
          const proxyImageUrl = `/api/image-proxy?url=${encodeURIComponent(enhancedImageUrl)}`;
          setImageUrl(proxyImageUrl);
        } else {
          // For BestBuy and Home Depot, use the image URL as is through our proxy
          const proxyImageUrl = `/api/image-proxy?url=${encodeURIComponent(foundImage)}`;
          setImageUrl(proxyImageUrl);
        }
      } else {
        setError("No matching image found");
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-8">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Product Image Search</h1>
          <Link href="/csv" className="text-blue-500 hover:underline">
            CSV Bulk Processing
          </Link>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Select value={store} onValueChange={setStore}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TARGET">TARGET</SelectItem>
                <SelectItem value="BESTBUY">BEST BUY</SelectItem>
                <SelectItem value="HOMEDEPOT">HOME DEPOT</SelectItem>
              </SelectContent>
            </Select>
            
            <Input
              placeholder="Enter product search term..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? "Searching..." : "Search"}
            </Button>
          </div>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          
          {imageUrl && (
            <div className="mt-6 flex flex-col items-center">
              <img 
                src={imageUrl} 
                alt="Product" 
                className="max-w-full max-h-[500px] object-contain border rounded"
              />
              <p className="mt-2 text-sm text-gray-500 break-all">
                {/* Show the original URL, not the proxy URL for user reference */}
                {imageUrl.startsWith('/api/image-proxy?url=') 
                  ? decodeURIComponent(imageUrl.replace('/api/image-proxy?url=', ''))
                  : imageUrl}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
