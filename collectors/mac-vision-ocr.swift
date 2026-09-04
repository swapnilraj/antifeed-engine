#!/usr/bin/env swift
// Reads on-screen text from image files using the macOS Vision framework.
//
// Usage: swift mac-vision-ocr.swift <image1> [<image2> ...]
//
// Prints the recognized text lines for all images to stdout, one line per
// recognized string. Lines are emitted in reading order per image; the caller
// is responsible for de-duplicating repeated lines (reel text persists across
// consecutive frames). Exits non-zero only on a Vision/runtime failure so the
// caller can fall back to another OCR engine; images with no text simply
// produce no output.
import Foundation
import Vision
import AppKit

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
    FileHandle.standardError.write("usage: swift mac-vision-ocr.swift <image> [<image> ...]\n".data(using: .utf8)!)
    exit(2)
}

var out = ""
for path in paths {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("skip unreadable image: \(path)\n".data(using: .utf8)!)
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        FileHandle.standardError.write("vision failed on \(path): \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    guard let observations = request.results else { continue }
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let line = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if !line.isEmpty { out += line + "\n" }
    }
}
FileHandle.standardOutput.write(out.data(using: .utf8)!)
