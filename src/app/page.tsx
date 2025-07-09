
"use client";

import { useState, useMemo, useCallback, ChangeEvent } from "react";
import Image from "next/image";
import { FileImage, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import Papa from "papaparse";
import QRCode from "qrcode";
import JSZip from "jszip";

const DPI = 300;
const cmToPx = (cm: number) => Math.round((cm / 2.54) * DPI);

type QrConfig = {
  qrSizeCm: number;
  marginTopCm: number;
  marginRightCm: number;
};

export default function Home() {
  const [qrCount, setQrCount] = useState<1 | 2>(1);
  const [bgDimensions, setBgDimensions] = useState({ widthCm: 16, heightCm: 9 });
  const [qrConfigs, setQrConfigs] = useState<QrConfig[]>([
    { qrSizeCm: 3, marginTopCm: 2.4, marginRightCm: 0.9 }, // QR1 config
    { qrSizeCm: 3, marginTopCm: 2.4, marginRightCm: 5.0 }, // QR2 config
  ]);
  
  const [bgImage, setBgImage] = useState<{ file: File; url: string } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [links, setLinks] = useState<Record<string, string>[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const handleBgImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.type.startsWith('image/')) {
        setBgImage({ file, url: URL.createObjectURL(file) });
      } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid image file (JPG, PNG, etc.)." });
      }
    }
  };

  const handleCsvChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setCsvFile(file);
        setLinks([]); // Reset links on new file
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          delimiter: ",",
          complete: (results) => {
            if (results.errors.length > 0) {
              toast({ variant: "destructive", title: "CSV Parsing Error", description: results.errors[0].message });
              setLinks([]);
              return;
            }

            const requiredColumns = qrCount === 1 ? ["links"] : ["links1", "links2"];
            const hasRequiredColumns = requiredColumns.every(col => results.meta.fields?.includes(col));

            if (!hasRequiredColumns) {
              toast({ variant: "destructive", title: "Invalid CSV", description: `CSV must have column(s): ${requiredColumns.join(', ')}` });
              setLinks([]);
              setCsvFile(null);
              return;
            }
            
            const parsedLinks = (results.data as Record<string, string>[])
              .map(row => {
                  const linkData: Record<string, string> = {};
                  let hasAnyLink = false;
                  requiredColumns.forEach(col => {
                      if (row[col] && typeof row[col] === 'string' && row[col].trim()) {
                          linkData[col] = row[col].trim();
                          hasAnyLink = true;
                      }
                  });
                  return hasAnyLink ? linkData : null;
              })
              .filter(Boolean) as Record<string, string>[];

            setLinks(parsedLinks);
            if (parsedLinks.length > 0) {
              toast({ title: "CSV Parsed", description: `Found ${parsedLinks.length} rows with links.` });
            } else {
              toast({ variant: "destructive", title: "No Links Found", description: `No valid links found in the '${requiredColumns.join("' and '")}' column(s).` });
            }
          },
        });
      } else {
        toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid CSV file." });
      }
    }
  };
  
  const handleBgDimChange = (key: 'widthCm' | 'heightCm', value: number) => {
    setBgDimensions(prev => ({ ...prev, [key]: value }));
    setQrConfigs(prev => prev.map(config => ({
        ...config,
        marginTopCm: Math.min(config.marginTopCm, (key === 'heightCm' ? value : bgDimensions.heightCm) - config.qrSizeCm),
        marginRightCm: Math.min(config.marginRightCm, (key === 'widthCm' ? value : bgDimensions.widthCm) - config.qrSizeCm)
    })));
  };

  const handleQrConfigChange = (index: number, key: keyof QrConfig, value: number) => {
    setQrConfigs(prev => {
        const newConfigs = [...prev];
        newConfigs[index] = { ...newConfigs[index], [key]: value };
        return newConfigs;
    });
  };

  const previewStyles = useMemo(() => {
    return qrConfigs.slice(0, qrCount).map(config => {
        if (!bgImage) return {};
        const qrWidthPercent = (config.qrSizeCm / bgDimensions.widthCm) * 100;
        const qrTopPercent = (config.marginTopCm / bgDimensions.heightCm) * 100;
        const qrRightPercent = (config.marginRightCm / bgDimensions.widthCm) * 100;

        return {
            top: `${qrTopPercent}%`,
            right: `${qrRightPercent}%`,
            width: `${qrWidthPercent}%`,
        };
    });
  }, [qrConfigs, qrCount, bgDimensions, bgImage]);

  const generateImages = useCallback(async () => {
    if (!bgImage || links.length === 0) {
      toast({ variant: "destructive", title: "Missing Inputs", description: "Please upload a background image and a valid CSV with links." });
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    const zip = new JSZip();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast({ variant: "destructive", title: "Error", description: "Could not create a canvas context." });
      setIsProcessing(false);
      return;
    }
    
    const outputWidthPx = cmToPx(bgDimensions.widthCm);
    const outputHeightPx = cmToPx(bgDimensions.heightCm);
    canvas.width = outputWidthPx;
    canvas.height = outputHeightPx;

    const bgImageElement = document.createElement('img');
    bgImageElement.src = bgImage.url;
    await new Promise(resolve => { bgImageElement.onload = resolve; });

    for (let i = 0; i < links.length; i++) {
      const linkData = links[i];
      
      ctx.drawImage(bgImageElement, 0, 0, outputWidthPx, outputHeightPx);
      
      for (let j = 0; j < qrCount; j++) {
        const config = qrConfigs[j];
        const linkKey = j === 0 ? (qrCount === 1 ? 'links' : 'links1') : 'links2';
        const link = linkData[linkKey];

        if (!link) {
          console.warn(`Skipping QR ${j + 1} for row ${i + 1} due to missing link for key '${linkKey}'`);
          continue;
        }

        const qrDataUrl = await QRCode.toDataURL(link, { 
            errorCorrectionLevel: 'H', 
            margin: 0,
            scale: 10, // A higher scale gives better quality for resizing
            color: { light: '#FFFFFF00' } // Transparent background
        });

        const qrImageElement = document.createElement('img');
        qrImageElement.src = qrDataUrl;
        await new Promise(resolve => { qrImageElement.onload = resolve; });

        const qrSizePx = cmToPx(config.qrSizeCm);
        const pasteX = outputWidthPx - qrSizePx - cmToPx(config.marginRightCm);
        const pasteY = cmToPx(config.marginTopCm);
        
        ctx.fillStyle = "white";
        ctx.fillRect(pasteX, pasteY, qrSizePx, qrSizePx);
        ctx.drawImage(qrImageElement, pasteX, pasteY, qrSizePx, qrSizePx);
      }
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) {
        zip.file(`qr_image_${i + 1}.jpg`, blob);
      }
      
      setProgress(((i + 1) / links.length) * 100);
    }
    
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "uvify_outputs.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    
    setIsProcessing(false);
    toast({ title: "Success!", description: "Your images have been generated and downloaded." });
  }, [bgImage, links, qrConfigs, qrCount, bgDimensions, toast]);

  const fileInputStyles = "file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer";
  
  const QrConfigControls = ({ index }: { index: number }) => {
    const config = qrConfigs[index];
    if (!config) return null;

    return (
      <div className="space-y-6 pt-2">
        <div className="space-y-4">
          <Label>QR Size (cm): {config.qrSizeCm.toFixed(1)}</Label>
          <Slider value={[config.qrSizeCm]} onValueChange={([v]) => handleQrConfigChange(index, 'qrSizeCm', v)} min={1} max={Math.min(bgDimensions.widthCm, bgDimensions.heightCm)} step={0.1}/>
        </div>
        <div className="space-y-4">
          <Label>Top Margin (cm): {config.marginTopCm.toFixed(1)}</Label>
          <Slider value={[config.marginTopCm]} onValueChange={([v]) => handleQrConfigChange(index, 'marginTopCm', v)} min={0} max={bgDimensions.heightCm - config.qrSizeCm} step={0.1}/>
        </div>
        <div className="space-y-4">
          <Label>Right Margin (cm): {config.marginRightCm.toFixed(1)}</Label>
          <Slider value={[config.marginRightCm]} onValueChange={([v]) => handleQrConfigChange(index, 'marginRightCm', v)} min={0} max={bgDimensions.widthCm - config.qrSizeCm} step={0.1}/>
        </div>
      </div>
    );
  };

  const csvDescription = useMemo(() => {
    const cols = qrCount === 1 ? "'links'" : "'links1' and 'links2'";
    return `File must have column(s) ${cols}. Found ${links.length} row(s).`
  }, [qrCount, links.length]);


  return (
    <div className="min-h-screen bg-background text-foreground font-body">
      <header className="py-6 px-8 border-b border-border shadow-sm bg-card">
        <h1 className="text-4xl font-bold font-headline text-primary">Uvify</h1>
        <p className="text-muted-foreground mt-1">A simple tool to batch-create QR codes on images.</p>
      </header>
      
      <main className="grid grid-cols-1 lg:grid-cols-5 gap-8 p-4 md:p-8">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">1</span>Upload Files</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div>
                 <Label htmlFor="bg-upload" className="mb-2 block">Background Image</Label>
                 <Input id="bg-upload" type="file" accept="image/*" onChange={handleBgImageChange} className={fileInputStyles}/>
               </div>
               <div>
                  <Label htmlFor="csv-upload" className="mb-2 block">Links CSV File</Label>
                  <CardDescription className="mb-2 text-xs">{csvDescription}</CardDescription>
                  <Input id="csv-upload" type="file" accept=".csv,text/csv" onChange={handleCsvChange} disabled={!bgImage} className={fileInputStyles}/>
               </div>
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3"><span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">2</span>Configure Layout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bg-width">Image Width (cm)</Label>
                  <Input id="bg-width" type="number" value={bgDimensions.widthCm} onChange={e => handleBgDimChange('widthCm', +e.target.value)} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="bg-height">Image Height (cm)</Label>
                  <Input id="bg-height" type="number" value={bgDimensions.heightCm} onChange={e => handleBgDimChange('heightCm', +e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Number of QR Codes</Label>
                <RadioGroup defaultValue="1" onValueChange={(v) => { setQrCount(v === '1' ? 1 : 2); setLinks([]); setCsvFile(null); }} className="flex gap-4 pt-1">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="1" id="r1" />
                    <Label htmlFor="r1">One</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="2" id="r2" />
                    <Label htmlFor="r2">Two</Label>
                  </div>
                </RadioGroup>
              </div>

               {qrCount === 1 ? (
                 <QrConfigControls index={0} />
               ) : (
                 <Tabs defaultValue="qr1" className="w-full">
                   <TabsList className="grid w-full grid-cols-2">
                     <TabsTrigger value="qr1">QR 1 Settings</TabsTrigger>
                     <TabsTrigger value="qr2">QR 2 Settings</TabsTrigger>
                   </TabsList>
                   <TabsContent value="qr1">
                     <QrConfigControls index={0} />
                   </TabsContent>
                   <TabsContent value="qr2">
                     <QrConfigControls index={1} />
                   </TabsContent>
                 </Tabs>
               )}
            </CardContent>
          </Card>
          
          <div className="mt-auto pt-6 flex flex-col items-center">
            <Button size="lg" className="w-full text-lg font-bold" onClick={generateImages} disabled={!bgImage || links.length === 0 || isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin mr-2"/> : <Download className="mr-2"/>}
              {isProcessing ? `Processing...` : `Generate & Download Zip`}
            </Button>
            {isProcessing && <div className="w-full text-center mt-2">
              <Progress value={progress} className="w-full h-3" />
              <p className="text-sm text-muted-foreground mt-1">{Math.round(progress)}% Complete</p>
            </div>}
          </div>
        </div>

        <div className="lg:col-span-3">
          <Card className="sticky top-8 shadow-lg">
             <CardHeader>
                <CardTitle>Live Preview</CardTitle>
                <CardDescription>A representation of your final image layout.</CardDescription>
             </CardHeader>
             <CardContent>
               <div className="aspect-video bg-muted/50 rounded-lg flex items-center justify-center relative overflow-hidden border">
                {bgImage ? (
                  <>
                    <Image src={bgImage.url} alt="Background Preview" fill className="object-contain" />
                    {previewStyles.map((style, index) => (
                       <div 
                        key={index}
                        className="absolute bg-primary/50 border-2 border-dashed border-accent"
                        style={{...style, aspectRatio: '1 / 1'}}
                      >
                        <div className="w-full h-full flex items-center justify-center">
                          <p className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded-sm">QR {index+1}</p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center text-muted-foreground p-8">
                    <FileImage className="mx-auto h-16 w-16 opacity-50"/>
                    <p className="mt-4 font-medium">Upload a background image to see the preview</p>
                  </div>
                )}
               </div>
             </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
