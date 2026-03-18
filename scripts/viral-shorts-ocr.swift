import Foundation
import Vision
import AppKit

struct OCRResult: Encodable {
    let path: String
    let fullText: String
    let topHalfText: String
}

func recognizeText(from image: CGImage, cropTopHalf: Bool) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US", "ru-RU"]

    let handler: VNImageRequestHandler
    if cropTopHalf {
        let height = image.height / 2
        guard let cropped = image.cropping(to: CGRect(x: 0, y: image.height - height, width: image.width, height: height)) else {
            return ""
        }
        handler = VNImageRequestHandler(cgImage: cropped, options: [:])
    } else {
        handler = VNImageRequestHandler(cgImage: image, options: [:])
    }

    try handler.perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
}

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: swift viral-shorts-ocr.swift <image-path> [...]\n", stderr)
    exit(1)
}

let paths = Array(CommandLine.arguments.dropFirst())
var results: [OCRResult] = []

for path in paths {
    let url = URL(fileURLWithPath: path)
    guard
        let image = NSImage(contentsOf: url),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else {
        continue
    }

    let fullText = (try? recognizeText(from: cgImage, cropTopHalf: false)) ?? ""
    let topHalfText = (try? recognizeText(from: cgImage, cropTopHalf: true)) ?? ""
    results.append(OCRResult(path: path, fullText: fullText, topHalfText: topHalfText))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(results)
FileHandle.standardOutput.write(data)
