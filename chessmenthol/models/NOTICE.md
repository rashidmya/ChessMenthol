# Bundled model attribution

`pieces.onnx` is derived by format-converting the pretrained **pieces** weights of
**chess-cv** (https://github.com/S1M0N38/chess-cv, https://huggingface.co/S1M0N38/chess-cv),
© S1M0N38, released under the MIT License. Only the model weights were reused; they were
converted from MLX/SafeTensors to ONNX for inference via OpenCV's `cv2.dnn`. No chess-cv
source code is redistributed. See the upstream repository for the full MIT license text.
